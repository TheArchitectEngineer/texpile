// The word count of a whole document: its main file and every file it brings in, each counted
// on its own (proseWords.ts), in the order the document reads them.
//
// LaTeX brings a file in with \input, \include, \subfile or \import; TeX looks for it from the
// directory it runs in, which is the main file's (the compile runs there), and the file that
// names it and the project root are tried after. A main file's \input in its preamble reads
// macros, not text, so only the document body's count. Typst brings a file in with #include,
// named from the file that includes it.
import { addTally, latexWords, NO_WORDS, typstWords, type WordTally } from './proseWords';
import { dirname, joinPath, normalizePath, samePath } from '$lib/workspace/fileSystem';

export type FileWords = {
	path: string;
	words: WordTally;
	/** named by an include but not found */
	missing?: true;
};

export type ProjectWords = { files: FileWords[]; total: WordTally };

type Read = (path: string) => Promise<string>;

/** one file, however its path is spelled (separators, case, dot segments) */
function fileKey(path: string): string {
	return normalizePath(path).replace(/\\/g, '/').toLowerCase();
}

const LATEX_INCLUDE = /\\(?:input|include|subfile|subfileinclude)\s*\{([^}]+)\}/g;
const LATEX_IMPORT = /\\(sub)?(?:import|inputfrom|includefrom)\*?\s*\{([^}]*)\}\s*\{([^}]+)\}/g;
const TYPST_INCLUDE = /#include\s+"([^"]+)"/g;

// what TeX does not read: a comment, to the end of its line
function uncommented(tex: string): string {
	return tex.replace(/(^|[^\\])%[^\n]*/g, '$1');
}

// TeX adds .tex to a name that has no extension of its own
function withTex(name: string): string {
	return /\.[A-Za-z0-9]+$/.test(name.trim()) ? name.trim() : `${name.trim()}.tex`;
}

function isTypst(path: string): boolean {
	return /\.typ$/i.test(path);
}

/** the files `text` brings in, as candidate paths to try in turn */
function includesOf(path: string, text: string, main: string, root: string): string[][] {
	if (isTypst(path)) return [...text.matchAll(TYPST_INCLUDE)].map((m) => [joinPath(dirname(path), m[1])]);
	let tex = uncommented(text);
	if (samePath(path, main)) {
		const begin = /\\begin\s*\{document\}/.exec(tex);
		if (begin) tex = tex.slice(begin.index);
	}
	const found: { at: number; tries: string[] }[] = [];
	for (const m of tex.matchAll(LATEX_INCLUDE)) {
		const ref = withTex(m[1]);
		found.push({ at: m.index ?? 0, tries: [joinPath(dirname(main), ref), joinPath(dirname(path), ref), joinPath(root, ref)] });
	}
	for (const m of tex.matchAll(LATEX_IMPORT)) {
		// \subimport is named from the file it is in, \import from where TeX runs
		const base = m[1] ? dirname(path) : dirname(main);
		found.push({ at: m.index ?? 0, tries: [joinPath(joinPath(base, m[2]), withTex(m[3]))] });
	}
	return found.sort((a, b) => a.at - b.at).map((f) => f.tries);
}

/**
 * Counts `main` and everything it brings in. `read` gives a file's text (the open file's from its
 * editor, so unsaved edits count) and throws for a file that is not there.
 */
export async function countProjectWords(main: string, root: string, read: Read): Promise<ProjectWords> {
	const files: FileWords[] = [];
	const seen = new Set<string>();

	async function visit(path: string, text: string, depth: number): Promise<void> {
		const words = isTypst(path) ? typstWords(text) : latexWords(text, samePath(path, main));
		files.push({ path, words });
		if (depth >= 20) return;
		for (const tries of includesOf(path, text, main, root)) {
			const unique = tries.map(normalizePath).filter((p, i, all) => all.findIndex((q) => samePath(p, q)) === i);
			if (unique.some((p) => seen.has(fileKey(p)))) continue;
			let got: { path: string; text: string } | null = null;
			for (const p of unique) {
				try {
					got = { path: p, text: await read(p) };
					break;
				} catch {
					/* the next place TeX would look */
				}
			}
			if (!got) {
				seen.add(fileKey(unique[0]));
				files.push({ path: unique[0], words: NO_WORDS, missing: true });
				continue;
			}
			seen.add(fileKey(got.path));
			await visit(got.path, got.text, depth + 1);
		}
	}

	seen.add(fileKey(main));
	await visit(main, await read(main), 0);
	return { files, total: files.reduce((t, f) => addTally(t, f.words), NO_WORDS) };
}

/** whether `path` is one of the files counting `main` read */
export function counts(result: ProjectWords, path: string): boolean {
	return result.files.some((f) => !f.missing && samePath(f.path, path));
}
