import { countProse, latexProse, typstProse, type ProseCount } from '$lib/workspace/wordCount/proseWords';
import { trailingDebounce } from '$lib/trailingDebounce';

export type DocumentCount = {
	words: number;
	characters: number;
	charactersWithSpaces: number;
	// null when the selection is collapsed
	selectionWords: number | null;
	selectionCharacters: number | null;
	selectionCharactersWithSpaces: number | null;
};

export const documentCountStore = $state<DocumentCount>({
	words: 0,
	characters: 0,
	charactersWithSpaces: 0,
	selectionWords: null,
	selectionCharacters: null,
	selectionCharactersWithSpaces: null
});

// exactly the JS /\s/ class (ASCII whitespace, NBSP, Zs separators, LS/PS, BOM)
function isSpace(c: number): boolean {
	if (c === 32 || (c >= 9 && c <= 13)) return true;
	if (c < 160) return false;
	return (
		c === 160 ||
		c === 0x1680 ||
		(c >= 0x2000 && c <= 0x200a) ||
		c === 0x2028 ||
		c === 0x2029 ||
		c === 0x202f ||
		c === 0x205f ||
		c === 0x3000 ||
		c === 0xfeff
	);
}

// one charCode pass: words = runs of non-whitespace, characters = non-whitespace count. The old
// trim/split/filter built an array of every word (~150k strings at 1MB) plus a stripped copy.
function countText(text: string): { words: number; characters: number } {
	let words = 0;
	let characters = 0;
	let inWord = false;
	for (let i = 0; i < text.length; i++) {
		if (isSpace(text.charCodeAt(i))) inWord = false;
		else {
			characters++;
			if (!inWord) words++;
			inWord = true;
		}
	}
	return { words, characters };
}

/** how the source view counts a file: LaTeX and Typst by their prose, anything else as it reads */
export type SourceCounting = 'latex' | 'typst' | 'text';

export function sourceCounting(path: string): SourceCounting {
	return /\.tex$/i.test(path) ? 'latex' : /\.typ$/i.test(path) ? 'typst' : 'text';
}

// A LaTeX or Typst file counts its prose here too, as the visual editor and the detailed count
// (proseWords.ts) do, so the number is the same in either view and in the details: counting the
// buffer verbatim made \section{Model} and \parencite{he2016} two words. `main`, as the details
// take the file their count starts from: a chapter has no \begin{document}, so it counts whole.
function sourceCount(text: string, as: SourceCounting, main: boolean): ProseCount {
	if (as === 'latex') return countProse(latexProse(text, main));
	if (as === 'typst') return countProse(typstProse(text));
	return { ...countText(text), charactersWithSpaces: text.length };
}

// Feed the store from the source editor's text. Selection null/empty clears the selection counts.
export function setSourceDocCount(text: string, as: SourceCounting = 'text'): void {
	const { words, characters, charactersWithSpaces } = sourceCount(text, as, true);
	documentCountStore.words = words;
	documentCountStore.charactersWithSpaces = charactersWithSpaces;
	documentCountStore.characters = characters;
}

let countedPath: string | null = null;
const deferredOpenCount = trailingDebounce(300, ({ text, as }: { text: string; as: SourceCounting }) => setSourceDocCount(text, as));

/**
 * The open file's count while it is LaTeX or Typst: from its text in either view, which the
 * visual editor writes each edit back into and the detailed count reads, so the top bar and the
 * details are one number (the visual editor's own document holds a \cref it shows as code, and a
 * \ref's key, as text).
 * The editors count any other file, and every selection, themselves. A file just opened counts at
 * once, so the last one's number does not stay up while typing settles.
 */
export function countOpenFile(path: string | null, text: string): void {
	const as = path ? sourceCounting(path) : 'text';
	if (as === 'text') {
		countedPath = null;
		deferredOpenCount.cancel();
		return;
	}
	if (path === countedPath) return deferredOpenCount({ text, as });
	countedPath = path;
	deferredOpenCount.cancel();
	setSourceDocCount(text, as);
}

export function setSourceSelectionCount(selText: string | null, as: SourceCounting = 'text'): void {
	if (selText && selText.length) {
		const { words, characters, charactersWithSpaces } = sourceCount(selText, as, false);
		documentCountStore.selectionWords = words;
		documentCountStore.selectionCharactersWithSpaces = charactersWithSpaces;
		documentCountStore.selectionCharacters = characters;
	} else {
		documentCountStore.selectionWords = null;
		documentCountStore.selectionCharacters = null;
		documentCountStore.selectionCharactersWithSpaces = null;
	}
}
