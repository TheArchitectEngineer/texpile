// Replace across the folder: the text rewrite, and the walk over the files the search listed.
//
// A file is rewritten from its whole current text, never from the result list: the list is
// capped, and a line in it is cut at 400 characters. Matching is the search's own - line by
// line, a plain string or a regex, case-folded unless asked not to - so every match the panel
// showed is a match replaced, and nothing it did not show is.
//
// The open file is the one with a live buffer and an editor, so its change goes through that
// editor: undoable there, and seen by suggestion mode and a shared session like any edit.
// Every other file is rewritten on disk, in its own line endings; a file that is not UTF-8 is
// left alone, since writing it back would mangle it (the editor opens those read-only too).
import { detectEol, fromLf, samePath, toLf, type Eol } from '$lib/workspace/fileSystem';

export type ReplaceSpec = {
	query: string;
	replacement: string;
	regex: boolean;
	caseSensitive: boolean;
};

/** the search's matcher as a global regex, or null for an empty query or an invalid pattern */
export function matcher(spec: ReplaceSpec): RegExp | null {
	if (!spec.query) return null;
	const source = spec.regex ? spec.query : spec.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	try {
		return new RegExp(source, spec.caseSensitive ? 'g' : 'gi');
	} catch {
		return null;
	}
}

/**
 * `text` (LF) with every match replaced, line by line as the search matched it, and how many.
 * A regex replacement may use $1 and $&; a plain one is taken literally.
 */
export function replaceInText(text: string, spec: ReplaceSpec): { text: string; count: number } {
	const re = matcher(spec);
	if (!re) return { text, count: 0 };
	let count = 0;
	const lines = text.split('\n').map((line) => {
		re.lastIndex = 0;
		const hits = line.match(re)?.length ?? 0;
		if (!hits) return line;
		count += hits;
		return spec.regex ? line.replace(re, spec.replacement) : line.replace(re, () => spec.replacement);
	});
	return { text: count ? lines.join('\n') : text, count };
}

export type ReplaceDeps = {
	/** the file with a live buffer: its path, text (LF) and line ending, or null when none can take an edit */
	open(): { path: string; text: string; eol: Eol } | null;
	/** `next` into the open file's editor, replacing `before`; false when the editor would not take it */
	applyToOpen(before: string, next: string): Promise<boolean>;
	/** land any queued save of the open file, so the disk holds what its editor has */
	flush(): Promise<void>;
	read(path: string): Promise<{ text: string; encoding: string }>;
	write(path: string, text: string): Promise<void>;
	/** why a file read with this encoding cannot be written back, or null when it can */
	encodingError(encoding: string): string | null;
	/** our own writes are done: refresh the tree and the references */
	changed(): void;
};

type Change = { path: string; before: string; after: string; eol: Eol };

export type ReplaceOutcome = {
	files: number;
	matches: number;
	/** files that matched but were left as they were */
	skipped: { path: string; reason: 'encoding' | 'editor' | 'failed' }[];
	/** takes the whole replace back; throws, changing nothing, when a file was edited since */
	undo: (() => Promise<void>) | null;
	redo: (() => Promise<void>) | null;
};

/** A file edited after the replace: undo refuses rather than overwrite that edit. */
export class ChangedSinceError extends Error {
	constructor(readonly path: string) {
		super(path);
	}
}

export async function replaceInFiles(paths: readonly string[], spec: ReplaceSpec, deps: ReplaceDeps): Promise<ReplaceOutcome> {
	await deps.flush();
	const changes: Change[] = [];
	const skipped: ReplaceOutcome['skipped'] = [];
	let matches = 0;

	for (const path of paths) {
		try {
			const open = deps.open();
			if (open && samePath(open.path, path)) {
				const { text, count } = replaceInText(open.text, spec);
				if (!count) continue;
				if (!(await deps.applyToOpen(open.text, text))) {
					skipped.push({ path, reason: 'editor' });
					continue;
				}
				changes.push({ path, before: open.text, after: text, eol: open.eol });
				matches += count;
				continue;
			}
			const read = await deps.read(path);
			if (deps.encodingError(read.encoding)) {
				skipped.push({ path, reason: 'encoding' });
				continue;
			}
			const eol = detectEol(read.text);
			const before = toLf(read.text);
			const { text, count } = replaceInText(before, spec);
			if (!count) continue;
			await deps.write(path, fromLf(text, eol));
			changes.push({ path, before, after: text, eol });
			matches += count;
		} catch {
			skipped.push({ path, reason: 'failed' });
		}
	}
	if (changes.length) {
		// the open file's edit is queued as a save; land it, so a search run now reads the new text
		await deps.flush();
		deps.changed();
	}

	return {
		files: changes.length,
		matches,
		skipped,
		undo: changes.length ? () => restore(changes, 'after', 'before', deps) : null,
		redo: changes.length ? () => restore(changes, 'before', 'after', deps) : null
	};
}

/**
 * Puts every changed file from its `from` text back to its `to` text: all of them or none. Each
 * file is checked first, and one that no longer holds `from` stops the whole step, so an undo
 * never overwrites an edit made after the replace.
 */
async function restore(changes: readonly Change[], from: 'before' | 'after', to: 'before' | 'after', deps: ReplaceDeps): Promise<void> {
	await deps.flush();
	const current = await Promise.all(
		changes.map(async (c) => {
			const open = deps.open();
			if (open && samePath(open.path, c.path)) return { c, open: true, text: open.text };
			const read = await deps.read(c.path);
			return { c, open: false, text: toLf(read.text) };
		})
	);
	const stale = current.find(({ c, text }) => text !== c[from]);
	if (stale) throw new ChangedSinceError(stale.c.path);
	for (const { c, open } of current) {
		if (open) {
			if (!(await deps.applyToOpen(c[from], c[to]))) throw new ChangedSinceError(c.path);
		} else await deps.write(c.path, fromLf(c[to], c.eol));
	}
	await deps.flush();
	deps.changed();
}
