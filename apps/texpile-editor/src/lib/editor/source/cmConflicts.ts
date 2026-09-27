// The places a merge left marked in the file, drawn as two versions to choose between: this side's
// lines tinted one way, theirs another, and above each place a row of Keep mine / Keep theirs /
// Keep both. VS Code's merge-conflict decorations, in words that do not assume git.
//
// Each choice is one transaction and its own undo step. The marker lines stay as text: they are
// what is in the file, and hiding them would make deleting one by hand a surprise.
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { StateField, type EditorState, type Extension, type Range, type TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { scanConflicts, resolveConflict, type ConflictBlock, type ConflictChoice } from '$lib/workspace/conflictMarkers';
import { m } from '$lib/paraglide/messages';

/** the marked places in the document, rescanned on every change: a file holds a handful at most,
 *  and a line walk costs nothing next to what a keystroke already does */
export const conflictBlocks = StateField.define<ConflictBlock[]>({
	create: (state) => scanConflicts(state.doc.iterLines()),
	update: (blocks, tr) => (tr.docChanged ? scanConflicts(tr.state.doc.iterLines()) : blocks)
});

/** the change that settles one place: the whole block, markers and all, becomes the chosen lines */
export function chooseConflict(state: EditorState, block: ConflictBlock, choice: ConflictChoice): TransactionSpec {
	const insert = resolveConflict((a, b) => state.sliceDoc(a, b), block, choice);
	return {
		changes: { from: block.from, to: block.to, insert },
		selection: { anchor: block.from },
		scrollIntoView: true,
		userEvent: 'input.conflict',
		// its own undo step, never merged with the typing around it
		annotations: isolateHistory.of('full')
	};
}

const CHOICES: [ConflictChoice, () => string, () => string][] = [
	['mine', () => m.vcs_conflict_keep_mine(), () => m.vcs_conflict_keep_mine_tip()],
	['theirs', () => m.vcs_conflict_keep_theirs(), () => m.vcs_conflict_keep_theirs_tip()],
	['both', () => m.vcs_conflict_keep_both(), () => m.vcs_conflict_keep_both_tip()]
];

class ChoiceBar extends WidgetType {
	constructor(private readonly at: number) {
		super();
	}
	override eq(other: ChoiceBar): boolean {
		return other.at === this.at;
	}
	// eslint-disable-next-line @typescript-eslint/naming-convention -- @codemirror WidgetType API method
	toDOM(view: EditorView): HTMLElement {
		const bar = document.createElement('div');
		bar.className = 'cm-conflict-bar';
		bar.setAttribute('role', 'group');
		bar.setAttribute('aria-label', m.vcs_conflict_bar_aria());
		for (const [choice, label, tip] of CHOICES) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = `cm-conflict-choice cm-conflict-choice-${choice}`;
			button.textContent = label();
			button.title = tip();
			// the editor keeps its selection and focus until the choice lands
			button.addEventListener('mousedown', (e) => e.preventDefault());
			button.addEventListener('click', () => {
				// looked up at click time: typing above this place has moved it since the bar was drawn
				const at = view.posAtDOM(bar);
				const block = view.state.field(conflictBlocks, false)?.find((b) => b.from === at);
				if (!block) return;
				view.dispatch(chooseConflict(view.state, block, choice));
				view.focus();
			});
			bar.append(button);
		}
		return bar;
	}
	override ignoreEvent(): boolean {
		return true;
	}
}

/** a short name at the end of a marker line: whose lines start here */
class SideLabel extends WidgetType {
	constructor(
		private readonly text: string,
		private readonly side: 'mine' | 'theirs' | 'base'
	) {
		super();
	}
	override eq(other: SideLabel): boolean {
		return other.text === this.text && other.side === this.side;
	}
	// eslint-disable-next-line @typescript-eslint/naming-convention -- @codemirror WidgetType API method
	toDOM(): HTMLElement {
		const label = document.createElement('span');
		label.className = `cm-conflict-label cm-conflict-label-${this.side}`;
		label.textContent = this.text;
		return label;
	}
}

function theirsName(label: string): string {
	// git names the other side by ref ('refs/remotes/origin/main') or by commit ('1a2b3c4 (subject)')
	const name = label.replace(/^refs\/(?:remotes|heads)\//, '');
	return name ? m.vcs_conflict_theirs_named({ name }) : m.vcs_conflict_theirs();
}

function lineClasses(state: EditorState, span: { from: number; to: number }, cls: string, out: Range<Decoration>[]): void {
	if (span.to <= span.from) return;
	const deco = Decoration.line({ class: cls });
	// span.to sits just past the last line's break, which is the start of the next marker line
	for (let n = state.doc.lineAt(span.from).number, last = state.doc.lineAt(span.to - 1).number; n <= last; n++) {
		out.push(deco.range(state.doc.line(n).from));
	}
}

const dimmed = Decoration.mark({ class: 'cm-conflict-marker-text' });

/** a marker line: tinted as the side it opens, its text dimmed (not the label after it), and the
 *  label naming whose lines follow */
function markerLine(span: { from: number; to: number }, side: string, label: SideLabel | null, out: Range<Decoration>[]): void {
	out.push(Decoration.line({ class: `cm-conflict-marker cm-conflict-marker-${side}` }).range(span.from));
	if (span.to > span.from) out.push(dimmed.range(span.from, span.to));
	if (label) out.push(Decoration.widget({ widget: label, side: 1 }).range(span.to));
}

function build(state: EditorState): DecorationSet {
	const out: Range<Decoration>[] = [];
	for (const b of state.field(conflictBlocks)) {
		const { open, base, divider, close } = b.markers;
		out.push(Decoration.widget({ widget: new ChoiceBar(b.from), block: true, side: -1 }).range(b.from));
		markerLine(open, 'mine', new SideLabel(m.vcs_conflict_mine(), 'mine'), out);
		lineClasses(state, b.mine, 'cm-conflict-mine', out);
		if (base && b.base) {
			markerLine(base, 'base', new SideLabel(m.vcs_conflict_base(), 'base'), out);
			lineClasses(state, b.base, 'cm-conflict-base', out);
		}
		markerLine(divider, 'theirs', new SideLabel(theirsName(b.theirsLabel), 'theirs'), out);
		lineClasses(state, b.theirs, 'cm-conflict-theirs', out);
		markerLine(close, 'end', null, out);
	}
	return Decoration.set(out, true);
}

// block widgets have to come from a state field, not a view plugin
const decorations = StateField.define<DecorationSet>({
	create: build,
	update: (set, tr) => (tr.docChanged ? build(tr.state) : set),
	provide: (f) => EditorView.decorations.from(f)
});

const mineTint = 'var(--color-primary-500)';
const theirsTint = 'var(--color-secondary-500)';

const theme = EditorView.baseTheme({
	'.cm-conflict-mine': { backgroundColor: `color-mix(in srgb, ${mineTint} 10%, transparent)` },
	'.cm-conflict-theirs': { backgroundColor: `color-mix(in srgb, ${theirsTint} 10%, transparent)` },
	'.cm-conflict-base': { backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent)' },
	'.cm-conflict-marker-text': { color: 'color-mix(in srgb, currentColor 55%, transparent)' },
	'.cm-conflict-marker-mine': { backgroundColor: `color-mix(in srgb, ${mineTint} 22%, transparent)` },
	'.cm-conflict-marker-theirs, .cm-conflict-marker-end': { backgroundColor: `color-mix(in srgb, ${theirsTint} 22%, transparent)` },
	'.cm-conflict-marker-base': { backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)' },
	// the sides are told apart by their tint and a coloured edge, never by coloured words: a pale
	// theme colour as text on a light ground does not read
	'.cm-conflict-label': {
		marginLeft: '1.5ch',
		paddingLeft: '0.6ch',
		fontFamily: 'var(--font-sans, system-ui, sans-serif)',
		fontSize: '0.85em',
		fontWeight: '600'
	},
	'.cm-conflict-label-mine': { borderLeft: `3px solid ${mineTint}` },
	'.cm-conflict-label-theirs': { borderLeft: `3px solid ${theirsTint}` },
	'.cm-conflict-bar': {
		display: 'flex',
		gap: '4px',
		padding: '6px 0 2px',
		fontFamily: 'var(--font-sans, system-ui, sans-serif)',
		fontSize: '12px'
	},
	'.cm-conflict-choice': {
		border: '1px solid color-mix(in srgb, currentColor 25%, transparent)',
		borderRadius: '4px',
		padding: '1px 8px',
		background: 'transparent',
		color: 'inherit',
		cursor: 'pointer',
		font: 'inherit'
	},
	'.cm-conflict-choice:hover': { backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)' },
	'.cm-conflict-choice:focus-visible': { outline: '2px solid var(--color-primary-500)', outlineOffset: '1px' },
	'.cm-conflict-choice-mine': { borderLeft: `3px solid ${mineTint}` },
	'.cm-conflict-choice-theirs': { borderLeft: `3px solid ${theirsTint}` }
});

export function cmConflicts(): Extension {
	return [conflictBlocks, decorations, theme];
}
