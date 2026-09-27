// Replace across the folder, wired to the workspace (the work itself is lib/search/replaceInFiles.ts):
// the open file changes through its editor, the others on disk, and the whole replace is one
// entry in the file tree's undo history. That history is otherwise reached from the tree, so the
// toast that reports the replace offers the same undo.
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import { activeCompare, isDirty } from '$lib/workspace/workspaceStore';
import { basename, fromLf } from '$lib/workspace/fileSystem';
import { sourceEncodingError } from '$lib/workspace/sourceEncoding';
import { editOpenFile } from '$lib/workspace/openEditorEdit';
import { ChangedSinceError, replaceInFiles, type ReplaceDeps, type ReplaceOutcome, type ReplaceSpec } from '$lib/search/replaceInFiles';
import type { DocumentBuffer, FileKind } from '$lib/workspace/documentBuffer.svelte';
import type { ViewModeSwitch } from '$lib/workspace/viewModeSwitch.svelte';
import type { ParsedLatexFile } from '$lib/workspace/latexRoundtrip';
import type { SavePipeline } from '$lib/workspace/savePipeline.svelte';
import type { WorkspaceProvider } from '$lib/workspace/workspaceProvider';
import type { FileHistory } from '$lib/workspace/fileHistory.svelte';

export type FolderReplaceDeps = {
	provider: () => WorkspaceProvider;
	doc: DocumentBuffer;
	modes: ViewModeSwitch;
	kind: () => FileKind;
	parseVisual: (text: string) => Promise<ParsedLatexFile | null>;
	saver: () => SavePipeline;
	/** the tree's undo history, or null where nothing can be undone (no trash, a guest) */
	history: () => FileHistory | null;
	/** re-read the open file after it was written on disk */
	reloadOpen: () => Promise<void>;
};

export function makeFolderReplace(d: FolderReplaceDeps): (files: string[], spec: ReplaceSpec) => Promise<void> {
	const deps: ReplaceDeps = {
		open: () => (d.doc.path ? { path: d.doc.path, text: d.doc.buffer, eol: d.doc.eol } : null),
		async applyToOpen(before, next) {
			// a read-only file (not UTF-8) or one shown as a comparison takes no edit
			if (d.doc.encodingIssue || activeCompare.current || d.doc.buffer !== before) return false;
			const editor = { doc: d.doc, mode: () => d.modes.mode, kind: d.kind, parseVisual: d.parseVisual };
			if (await editOpenFile(editor, before, next)) return true;
			// no editor is showing it (a .bib in the reference manager): with nothing unsaved, the
			// file itself can take the change, and the reload that follows shows it
			if (isDirty.current || !d.doc.path) return false;
			await d.provider().writeText(d.doc.path, fromLf(next, d.doc.eol));
			await d.reloadOpen();
			return true;
		},
		flush: () => d.saver().flushAndWait(),
		read: (path) => d.provider().readSource(path),
		write: (path, text) => d.provider().writeText(path, text),
		encodingError: (encoding) => sourceEncodingError(encoding as Parameters<typeof sourceEncodingError>[0]),
		changed: () => dispatchEvent(new CustomEvent('texpile:fs-changed'))
	};

	return async (files, spec) => {
		let out: ReplaceOutcome;
		try {
			out = await replaceInFiles(files, spec, deps);
		} catch (e) {
			toaster.error({ title: m.globalsearch_replace_failed(), description: e instanceof Error ? e.message : String(e) });
			return;
		}
		report(out, d.history());
	};
}

function report(out: ReplaceOutcome, history: FileHistory | null): void {
	if (out.skipped.length) {
		toaster.warning({
			title:
				out.skipped.length === 1
					? m.globalsearch_replace_skipped_one()
					: m.globalsearch_replace_skipped_other({ count: out.skipped.length }),
			description: out.skipped.map((s) => `${basename(s.path)} (${skipReason(s.reason)})`).join(', '),
			duration: 10000
		});
	}
	if (!out.files || !out.undo || !out.redo) {
		if (!out.skipped.length) toaster.info({ title: m.globalsearch_replace_nothing() });
		return;
	}

	const results =
		out.matches === 1 ? m.globalsearch_results_count_one({ count: 1 }) : m.globalsearch_results_count_other({ count: out.matches });
	const where = out.files === 1 ? m.globalsearch_files_count_one({ count: 1 }) : m.globalsearch_files_count_other({ count: out.files });
	const entry = history
		? {
				label: out.files === 1 ? m.filehistory_op_replace_one() : m.filehistory_op_replace_other({ count: out.files }),
				undo: explained(out.undo),
				redo: explained(out.redo)
			}
		: null;
	if (history && entry) history.record(entry);
	toaster.success({
		title: m.globalsearch_replaced({ results, files: where }),
		// the undo on offer is this replace's only while it is still the last thing done
		action:
			history && entry
				? {
						label: m.menubar_undo(),
						// the stack holds its entries as reactive proxies, so identity is the undo function's
						onClick: () => history.undoStack.at(-1)?.undo === entry.undo && void history.undo()
					}
				: undefined
	});
}

/** a step that refuses because a file was edited since, saying which file */
function explained(step: () => Promise<void>): () => Promise<void> {
	return async () => {
		try {
			await step();
		} catch (e) {
			if (e instanceof ChangedSinceError) throw new Error(m.globalsearch_replace_changed_since({ name: basename(e.path) }), { cause: e });
			throw e;
		}
	};
}

function skipReason(reason: ReplaceOutcome['skipped'][number]['reason']): string {
	if (reason === 'encoding') return m.globalsearch_skip_encoding();
	if (reason === 'editor') return m.globalsearch_skip_editor();
	return m.globalsearch_skip_failed();
}
