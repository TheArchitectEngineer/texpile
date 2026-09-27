// Replace across the folder, wired to the workspace (the work itself is lib/search/replaceInFiles.ts):
// the open file changes through its editor, the others on disk, and the whole replace is one
// entry in the file tree's undo history. That history is otherwise reached from the tree, so the
// toast that reports the replace offers the same undo.
//
// A rename made in the open file - a label, a .bib entry's key - follows its uses into the other
// files the same way (lib/workspace/renameUses.ts has the patterns).
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import { activeCompare, isDirty } from '$lib/workspace/workspaceStore';
import { basename, fromLf, type SearchFileResult } from '$lib/workspace/fileSystem';
import { sourceEncodingError } from '$lib/workspace/sourceEncoding';
import { editOpenFile } from '$lib/workspace/openEditorEdit';
import { renameSpec, useLanguageOf, usePattern, type UseKind, type UseLanguage } from '$lib/workspace/renameUses';
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

function replaceDeps(d: FolderReplaceDeps): ReplaceDeps {
	return {
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
}

export function makeFolderReplace(d: FolderReplaceDeps): (files: string[], spec: ReplaceSpec) => Promise<void> {
	const deps = replaceDeps(d);
	return async (files, spec) => {
		const out = await attempt(() => replaceInFiles(files, spec, deps));
		if (!out) return;
		const results = count(out.matches, m.globalsearch_results_count_one, m.globalsearch_results_count_other);
		report(out, d.history(), {
			title: m.globalsearch_replaced({ results, files: filesText(out.files) }),
			label: out.files === 1 ? m.filehistory_op_replace_one() : m.filehistory_op_replace_other({ count: out.files }),
			nothing: m.globalsearch_replace_nothing()
		});
	};
}

export type RenameElsewhereDeps = FolderReplaceDeps & {
	root: () => string | null;
	search: (root: string, query: string, opts: { regex: boolean; caseSensitive: boolean }) => Promise<{ results: SearchFileResult[] }>;
};

/**
 * Queues a rename made in the open file for its uses elsewhere. A settings panel renames at every
 * keystroke (fig:r, fig:re, fig:res...), so a rename that continues the last one while that one
 * is still waiting extends it, and only the whole chain, first name to last, is carried out.
 */
export function makeRenameElsewhere(d: RenameElsewhereDeps): (kind: UseKind, from: string, to: string) => void {
	const deps = replaceDeps(d);
	let pending: { kind: UseKind; from: string; to: string; timer?: ReturnType<typeof setTimeout> } | null = null;

	async function run(kind: UseKind, from: string, to: string): Promise<void> {
		const root = d.root();
		if (!root || !from || !to || from === to) return;
		const langs: UseLanguage[] = ['latex', 'typst'];
		const found = await Promise.all(
			langs.map((lang) => d.search(root, usePattern(kind, from, lang), { regex: true, caseSensitive: true }))
		);
		const files = [...new Set(found.flatMap((r, i) => r.results.filter((f) => useLanguageOf(f.file) === langs[i]).map((f) => f.file)))];
		if (!files.length) return;
		const out = await attempt(() =>
			replaceInFiles(
				files,
				(path) => {
					const lang = useLanguageOf(path);
					return lang ? renameSpec(kind, from, to, lang) : null;
				},
				deps
			)
		);
		if (!out) return;
		const uses =
			kind === 'label'
				? count(out.matches, m.rename_refs_count_one, m.rename_refs_count_other)
				: count(out.matches, m.rename_cites_count_one, m.rename_cites_count_other);
		// the open file's own uses moved with the rename; a pass that finds nothing more is no news
		report(out, d.history(), {
			title: m.rename_elsewhere_done({ uses, files: filesText(out.files) }),
			label: m.filehistory_op_rename_uses({ from, to }),
			nothing: null
		});
	}

	return (kind, from, to) => {
		if (pending?.kind === kind && pending.to === from) {
			pending.to = to;
		} else if (pending) {
			const earlier = pending;
			clearTimeout(earlier.timer);
			void run(earlier.kind, earlier.from, earlier.to);
			pending = { kind, from, to };
		} else {
			pending = { kind, from, to };
		}
		const current = pending;
		clearTimeout(current.timer);
		current.timer = setTimeout(() => {
			pending = null;
			void run(current.kind, current.from, current.to);
		}, 800);
	};
}

async function attempt(work: () => Promise<ReplaceOutcome>): Promise<ReplaceOutcome | null> {
	try {
		return await work();
	} catch (e) {
		toaster.error({ title: m.globalsearch_replace_failed(), description: e instanceof Error ? e.message : String(e) });
		return null;
	}
}

function count(n: number, one: (a: { count: number }) => string, other: (a: { count: number }) => string): string {
	return n === 1 ? one({ count: 1 }) : other({ count: n });
}

function filesText(n: number): string {
	return count(n, m.globalsearch_files_count_one, m.globalsearch_files_count_other);
}

function report(out: ReplaceOutcome, history: FileHistory | null, text: { title: string; label: string; nothing: string | null }): void {
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
		if (!out.skipped.length && text.nothing) toaster.info({ title: text.nothing });
		return;
	}

	const entry = history ? { label: text.label, undo: explained(out.undo), redo: explained(out.redo) } : null;
	if (history && entry) history.record(entry);
	toaster.success({
		title: text.title,
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
