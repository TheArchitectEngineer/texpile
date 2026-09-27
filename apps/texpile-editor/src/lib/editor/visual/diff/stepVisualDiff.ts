// Previous and next change in a visual comparison: the marks visualDiffPlugin draws, stepped
// through from the caret and wrapping round, the way Alt+F5 steps through the source editor's.
// Marks that touch are one change: a replaced word is a deletion widget beside an insertion.
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { visualDiffKey } from './visualDiffPlugin';

/** exported for the tests: the changes as ranges, in document order, touching marks merged */
export function changeRanges(view: EditorView): { from: number; to: number }[] {
	const decos = visualDiffKey.getState(view.state)?.decorations.find() ?? [];
	const sorted = [...decos].sort((a, b) => a.from - b.from);
	const out: { from: number; to: number }[] = [];
	for (const d of sorted) {
		const last = out.at(-1);
		if (last && d.from <= last.to + 1) last.to = Math.max(last.to, d.to);
		else out.push({ from: d.from, to: d.to });
	}
	return out;
}

/** move the caret to the next (1) or previous (-1) change and bring it into view; false with none */
export function stepVisualDiff(view: EditorView, dir: 1 | -1): boolean {
	const ranges = changeRanges(view);
	if (!ranges.length) return false;
	const head = view.state.selection.head;
	const target =
		dir === 1 ? (ranges.find((r) => r.from > head) ?? ranges[0]) : ([...ranges].reverse().find((r) => r.to < head) ?? ranges.at(-1)!);
	const pos = Math.min(target.from, view.state.doc.content.size);
	view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView());
	view.focus();
	return true;
}
