// A change to the open file, made as an edit in whichever editor shows it rather than behind its
// back: undoable there, marked dirty and saved by the editor's own update path, turned into a
// suggestion in suggestion mode, and carried into a shared session. Writing the file on disk
// instead would reload it silently (losing the editor's undo) or raise the "changed outside
// the editor" prompt.
import { editorViewStore, sourceCmView } from '$lib/stores/editorStore';
import { hasVisualMode, type DocumentBuffer, type FileKind } from '$lib/workspace/documentBuffer.svelte';
import type { ParsedLatexFile } from '$lib/workspace/latexRoundtrip';
import type { SourceEdit } from '$lib/workspace/suggestionsController';
import { patchVisualFromSource } from '$lib/workspace/visualSourcePatch';

export type OpenEditorDeps = {
	doc: DocumentBuffer;
	mode: () => 'visual' | 'source';
	kind: () => FileKind;
	parseVisual: (text: string) => Promise<ParsedLatexFile | null>;
};

/**
 * `next` in place of `before` in the open file's editor. `edit` is the exact change when the
 * caller has one; otherwise the span between the texts' common start and end is replaced.
 * False when no editor is showing the file, or its text is no longer `before`.
 */
export async function editOpenFile(d: OpenEditorDeps, before: string, next: string, edit?: SourceEdit): Promise<boolean> {
	if (d.mode() === 'visual' && hasVisualMode(d.kind())) {
		const v = editorViewStore.current;
		return !!v && patchVisualFromSource(v, d.doc, d.parseVisual, before, next);
	}
	const cm = sourceCmView.current;
	if (!cm || cm.state.doc.toString() !== before) return false;
	cm.dispatch({ changes: edit ?? changedSpan(before, next) });
	return true;
}

/** the one range that turns `before` into `next`: all but their shared start and end */
export function changedSpan(before: string, next: string): SourceEdit {
	let start = 0;
	const max = Math.min(before.length, next.length);
	while (start < max && before[start] === next[start]) start++;
	let end = 0;
	while (end < max - start && before[before.length - 1 - end] === next[next.length - 1 - end]) end++;
	return { from: start, to: before.length - end, insert: next.slice(start, next.length - end) };
}
