// Lines changed since the last saved version, marked in the margin: VS Code's quick-diff bars.
// Green where lines were added, blue where they were changed, and a red wedge between two lines
// where some were removed. Alt+F5 and Shift+Alt+F5 go to the next and previous change.
//
// The last version's text arrives from outside (the editor has no git of its own) through
// setChangeBaseline; null turns the markers off, which is what a file with no saved version gets.
import { EditorView, GutterMarker, gutter, keymap, type Command } from '@codemirror/view';
import { EditorSelection, RangeSet, StateEffect, StateField, Text, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { m } from '$lib/paraglide/messages';

export const setChangeBaseline = StateEffect.define<string | null>();

type Diff = { base: Text | null; chunks: readonly Chunk[] };

// a long, very different file falls back to a coarser diff rather than stall a keystroke
const DIFF = { scanLimit: 1000, timeout: 40 };

export const changeDiff = StateField.define<Diff>({
	create: () => ({ base: null, chunks: [] }),
	update(value, tr) {
		for (const e of tr.effects) {
			if (!e.is(setChangeBaseline)) continue;
			const base = e.value === null ? null : Text.of(e.value.split('\n'));
			return { base, chunks: base ? Chunk.build(base, tr.state.doc, DIFF) : [] };
		}
		if (!value.base || !tr.docChanged) return value;
		return { base: value.base, chunks: Chunk.updateB(value.chunks, value.base, tr.state.doc, tr.changes, DIFF) };
	}
});

export type ChangeKind = 'added' | 'modified' | 'removed';

/** each chunk as the lines it marks in the editor's document: exported for the tests */
export function changedLines(state: EditorState): { kind: ChangeKind; from: number; to: number }[] {
	const doc = state.doc;
	return state.field(changeDiff).chunks.map((c) => {
		const kind: ChangeKind = c.fromB === c.toB ? 'removed' : c.fromA === c.toA ? 'added' : 'modified';
		const from = doc.lineAt(Math.min(c.fromB, doc.length)).number;
		const to = kind === 'removed' ? from : doc.lineAt(Math.min(Math.max(c.fromB, c.endB), doc.length)).number;
		return { kind, from, to };
	});
}

class ChangeMarker extends GutterMarker {
	constructor(readonly kind: ChangeKind) {
		super();
	}
	override eq(other: ChangeMarker): boolean {
		return other.kind === this.kind;
	}
	// eslint-disable-next-line @typescript-eslint/naming-convention -- @codemirror GutterMarker API method
	override toDOM(): Node {
		const el = document.createElement('div');
		el.className = `cm-change-mark cm-change-${this.kind}`;
		el.title =
			this.kind === 'added' ? m.editor_change_added() : this.kind === 'modified' ? m.editor_change_modified() : m.editor_change_removed();
		return el;
	}
}

const MARKS = { added: new ChangeMarker('added'), modified: new ChangeMarker('modified'), removed: new ChangeMarker('removed') };

function markers(view: EditorView): RangeSet<GutterMarker> {
	const doc = view.state.doc;
	const out: Range<GutterMarker>[] = [];
	for (const c of changedLines(view.state)) {
		for (let n = c.from; n <= c.to; n++) out.push(MARKS[c.kind].range(doc.line(n).from));
	}
	return RangeSet.of(out, true);
}

/** the change after (or before) the caret's line, wrapping round the document */
function jump(dir: 1 | -1): Command {
	return (view) => {
		const changes = changedLines(view.state);
		if (!changes.length) return false;
		const here = view.state.doc.lineAt(view.state.selection.main.head).number;
		const next =
			dir === 1 ? (changes.find((c) => c.from > here) ?? changes[0]) : ([...changes].reverse().find((c) => c.to < here) ?? changes.at(-1)!);
		const at = view.state.doc.line(next.from).from;
		view.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: 'center' }) });
		return true;
	};
}

export const nextChange = jump(1);
export const previousChange = jump(-1);

const theme = EditorView.baseTheme({
	'.cm-change-gutter .cm-gutterElement': { padding: '0 1px 0 3px' },
	'.cm-change-mark': { width: '3px', height: '100%' },
	'.cm-change-added': { backgroundColor: 'var(--color-success-500)' },
	'.cm-change-modified': { backgroundColor: 'var(--color-primary-500)' },
	// removed lines leave no line to colour: a wedge at the top of the line they were above
	'.cm-change-removed': {
		width: '0',
		height: '0',
		borderTop: '4px solid transparent',
		borderBottom: '4px solid transparent',
		borderLeft: '5px solid var(--color-error-500)',
		transform: 'translateY(-4px)'
	}
});

export function cmChangeMarkers(): Extension {
	return [
		changeDiff,
		gutter({
			class: 'cm-change-gutter',
			markers,
			lineMarkerChange: (u) => u.startState.field(changeDiff) !== u.state.field(changeDiff)
		}),
		keymap.of([
			{ key: 'Alt-F5', run: nextChange },
			{ key: 'Shift-Alt-F5', run: previousChange }
		]),
		theme
	];
}
