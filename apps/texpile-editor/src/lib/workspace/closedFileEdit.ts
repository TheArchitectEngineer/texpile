// A change this app makes to a file that is not open (a replace across files), carried to what is
// pinned to that file. The open file's editor maps comments and suggestions through every edit; a
// file written straight to disk has no editor, so this does it before the write.
import { relativeTo } from '$lib/comments/store.svelte';
import type { EditMode } from '$lib/comments/suggestCompare';
import type { CommentsController } from './commentsController.svelte';
import { insertedSpans, type TextEdit } from './textEdits';
import { carriedAnchors } from './threadPlacement';

/**
 * Suggestions take the change as the reader's own edit in the mode they are in, so in suggestion
 * mode it becomes a suggestion, as it would in the open file. A comment on words it rewrote moves
 * onto what replaced them, rather than coming loose the next time the file opens. `undoing` puts
 * a replace's text back, which is an edit and never a suggestion: the ones the replace made close.
 */
export async function carryClosedEdit(
	ctl: CommentsController,
	root: string | null,
	mode: EditMode,
	change: { path: string; before: string; after: string; edits: TextEdit[]; undoing: boolean }
): Promise<void> {
	if (!root || !ctl.store.writable) return;
	const file = relativeTo(root, change.path);
	if (file === ctl.activeFile) return;
	const { before, after, edits } = change;
	const by = await ctl.author();
	await ctl.suggestions.remoteEdit(file, before, after, { by, mode: change.undoing ? 'editing' : mode, gestures: insertedSpans(edits) });
	await ctl.suggestions.beforeWrite(file, after);
	for (const { id, anchor } of carriedAnchors(ctl.store.forFile(file), before, after, edits)) {
		const thread = ctl.store.threads.find((t) => t.id === id);
		if (thread) await ctl.moveAnchor(thread, anchor, file, by);
	}
}
