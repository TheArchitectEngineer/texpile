// Words of prose in a LaTeX or Typst source, split into body text, headings, captions, footnotes
// and tables - the parts a word limit is usually stated in terms of.
//
// Only prose counts: maths, citations, references, labels, comments, code and the preamble do
// not. A LaTeX file is read through the spell checker's mask (texMask.ts), so the two agree on what
// prose is; a word is a run of text holding a letter or a digit, so a lone dash or bracket is none.
import { maskTex } from '$lib/editor/spellcheck/texMask';

export type WordTally = { body: number; headings: number; captions: number; footnotes: number; tables: number };

export const WORD_PARTS = ['body', 'headings', 'captions', 'footnotes', 'tables'] as const satisfies readonly (keyof WordTally)[];

export const NO_WORDS: WordTally = { body: 0, headings: 0, captions: 0, footnotes: 0, tables: 0 };

export function addTally(a: WordTally, b: WordTally): WordTally {
	const out = { ...a };
	for (const part of WORD_PARTS) out[part] += b[part];
	return out;
}

export function tallyTotal(t: WordTally): number {
	return WORD_PARTS.reduce((n, part) => n + t[part], 0);
}

type Part = Exclude<keyof WordTally, 'body'>;
type Region = { from: number; to: number; part: Part };

const WORD = /\S+/g;
const HAS_LETTER = /[\p{L}\p{N}]/u;

/** the words of `text` (same offsets as the source), each put in the part whose region holds it */
function tally(text: string, regions: Region[]): WordTally {
	const out = { ...NO_WORDS };
	regions.sort((a, b) => a.from - b.from);
	for (const w of text.matchAll(WORD)) {
		if (!HAS_LETTER.test(w[0])) continue;
		const at = w.index ?? 0;
		// the innermost region holding it: a caption inside a footnote counts as a caption
		let part: keyof WordTally = 'body';
		for (const r of regions) {
			if (r.from > at) break;
			if (at < r.to) part = r.part;
		}
		out[part]++;
	}
	return out;
}

const CLOSER: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

/** the end of the balanced group opening at `open` ({, [ or (), or -1 */
function closing(src: string, open: number): number {
	const o = src[open];
	const c = CLOSER[o];
	if (!c) return -1;
	let depth = 0;
	for (let k = open; k < src.length; k++) {
		const ch = src[k];
		if (ch === '\\') k++;
		else if (ch === o) depth++;
		else if (ch === c && --depth === 0) return k;
	}
	return -1;
}

// accents written as commands (caf\'e, na\"{\i}ve, \v{c}) would split a word in two: the letter
// they sit on stands for the whole of it
const ACCENT = /\\(?:['"^`~=.]\s*|[uvHcdbrtk](?=\{))(?:\{\s*(\\?[A-Za-z])\s*\}|([A-Za-z]))/g;
// a letter written as a command, which like any control word takes the spaces after it: Stra\ss e
const LETTER_COMMAND = /\\(?:ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![A-Za-z])(?:\{\}|[ \t]*)/g;

const LATEX_PARTS: [RegExp, Part][] = [
	[/\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*(?=\{)/g, 'headings'],
	[/\\caption\*?\s*(?:\[[^\]]*\])?\s*(?=\{)/g, 'captions'],
	[/\\footnote(?:text)?\s*(?:\[[^\]]*\])?\s*(?=\{)/g, 'footnotes'],
	[/\\title\s*(?:\[[^\]]*\])?\s*(?=\{)/g, 'headings']
];

// the cells of a table; a caption inside one (longtable) is still a caption
const TABLE_ENV = /\\begin\{(tabular\*?|tabularx|tabulary|longtable\*?|supertabular|tblr)\}[\s\S]*?\\end\{\1\}/g;

/**
 * The words of a LaTeX file. `main` is the file with \begin{document}: only its document body
 * counts, not the preamble nor anything after \end{document} - but a title \maketitle prints is
 * a heading, wherever \title was given.
 */
export function latexWords(source: string, main: boolean): WordTally {
	let src = source
		.replace(ACCENT, (_, braced?: string, bare?: string) => (braced ?? bare ?? '').replace('\\', ''))
		.replace(LETTER_COMMAND, 'x');
	if (main) {
		const begin = /\\begin\s*\{document\}/.exec(src);
		if (begin) {
			const from = begin.index + begin[0].length;
			const end = src.indexOf('\\end{document}', from);
			const body = src.slice(from, end < 0 ? undefined : end);
			let preamble = ' '.repeat(from);
			const title = /\\title\s*(?:\[[^\]]*\])?\s*\{/.exec(src.slice(0, from));
			const titleEnd = title ? closing(src, title.index + title[0].length - 1) : -1;
			if (title && titleEnd > 0 && /\\maketitle\b/.test(body))
				preamble = preamble.slice(0, title.index) + src.slice(title.index, titleEnd + 1) + preamble.slice(titleEnd + 1);
			src = preamble + body;
		}
	}
	// the list of references is the bibliography's, not the author's prose
	src = src.replace(/\\begin\{thebibliography\}[\s\S]*?(?:\\end\{thebibliography\}|$)/g, (m) => ' '.repeat(m.length));

	const regions: Region[] = [];
	for (const [re, part] of LATEX_PARTS) {
		for (const m of src.matchAll(re)) {
			const open = (m.index ?? 0) + m[0].length;
			const close = closing(src, open);
			if (close > open) regions.push({ from: open, to: close, part });
		}
	}
	for (const m of src.matchAll(TABLE_ENV)) regions.push({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, part: 'tables' });
	return tally(maskTex(src).text, regions);
}

/** a stretch of text as spaces, its line breaks kept, so every offset after it stays put */
function blank(text: string): string {
	return text.replace(/[^\n]/g, ' ');
}

/**
 * The words of a Typst file: markup and code taken out, headings (= lines), figure captions,
 * footnotes and the cells of a table counted apart.
 */
export function typstWords(source: string): WordTally {
	let src = source
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/(^|[^:])\/\/[^\n]*/g, (m, lead: string) => lead + ' '.repeat(m.length - lead.length))
		.replace(/```[\s\S]*?```/g, blank)
		.replace(/`[^`\n]*`/g, blank)
		.replace(/\$[^$]*\$/g, blank)
		// references and labels
		.replace(/(?<![\w@])@[\w:.-]*\w|<[\w:.-]+>/g, blank);

	// code: #let, #set, #show and #import lines up to the end of their brackets, and every
	// function call's (arguments) - but a [content] argument is prose and stays
	src = blankCode(src);

	const regions: Region[] = [];
	for (const m of src.matchAll(/^[ \t]*(=+)[ \t]+[^\n]*/gm))
		regions.push({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, part: 'headings' });
	for (const [re, part] of [
		[/caption\s*:\s*(?=\[)/g, 'captions'],
		[/#footnote\s*(?=\[)/g, 'footnotes'],
		[/#table\s*(?=\()/g, 'tables']
	] as const) {
		for (const m of source.matchAll(re)) {
			const open = (m.index ?? 0) + m[0].length;
			const close = closing(source, open);
			if (close > open) regions.push({ from: open, to: close, part });
		}
	}
	// what is left of the markup: emphasis marks, list markers, the = of a heading, a # call name
	const text = src.replace(/#[\w.-]+/g, blank).replace(/[*_=#[\]]/g, ' ');
	return tally(text, regions);
}

/** Typst code blanked out, keeping [content] blocks (they are prose) and every offset */
function blankCode(src: string): string {
	const out = src.split('');
	function blankRange(from: number, to: number) {
		for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
	}
	// a set/show/let/import rule, to the end of its line and of any brackets it opens there
	for (const m of src.matchAll(/#(?:let|set|show|import|include)\b[^\n]*/g)) {
		let end = (m.index ?? 0) + m[0].length;
		const opened = m[0].search(/[([{]/);
		if (opened >= 0) {
			const close = closing(src, (m.index ?? 0) + opened);
			if (close > end) end = close + 1;
		}
		blankRange(m.index ?? 0, end);
	}
	// a call's (arguments): blank them, but give back the content blocks inside
	for (const m of src.matchAll(/#[\w.]+(?=\()/g)) {
		const open = (m.index ?? 0) + m[0].length;
		const close = closing(src, open);
		if (close < 0) continue;
		const keep: [number, number][] = [];
		for (let k = open; k < close; k++) {
			if (src[k] !== '[') continue;
			const end = closing(src, k);
			if (end < 0 || end > close) break;
			keep.push([k + 1, end]);
			k = end;
		}
		const saved = keep.map(([a, b]) => out.slice(a, b));
		blankRange(open, close + 1);
		keep.forEach(([a], i) => saved[i].forEach((ch, j) => (out[a + j] = ch)));
	}
	return out.join('');
}
