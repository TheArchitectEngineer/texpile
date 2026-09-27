// The word count of a whole document: its main file and every file it brings in
// (documentFiles.ts), each counted on its own (proseWords.ts), in the order the document reads them.
import { addTally, latexWords, NO_WORDS, typstWords, type WordTally } from './proseWords';
import { documentFiles, type Read } from '$lib/workspace/documentFiles';
import { samePath } from '$lib/workspace/fileSystem';

export type FileWords = {
	path: string;
	words: WordTally;
	/** named by an include but not found */
	missing?: true;
};

export type ProjectWords = { files: FileWords[]; total: WordTally };

/**
 * Counts `main` and everything it brings in. `read` gives a file's text (the open file's from its
 * editor, so unsaved edits count) and throws for a file that is not there.
 */
export async function countProjectWords(main: string, root: string, read: Read): Promise<ProjectWords> {
	const files: FileWords[] = (await documentFiles(main, root, read)).map((f) =>
		f.missing
			? { path: f.path, words: NO_WORDS, missing: true }
			: { path: f.path, words: /\.typ$/i.test(f.path) ? typstWords(f.text) : latexWords(f.text, samePath(f.path, main)) }
	);
	return { files, total: files.reduce((t, f) => addTally(t, f.words), NO_WORDS) };
}

/** whether `path` is one of the files counting `main` read */
export function counts(result: ProjectWords, path: string): boolean {
	return result.files.some((f) => !f.missing && samePath(f.path, path));
}
