// Where a label or a citation key is used, as a pattern over a file's text, so a rename in the
// open file (a label, a .bib entry's key) can follow its uses into the project's other files.
// The patterns match the name alone, never the command around it, so the replacement is the new
// name and nothing else is rewritten:
//
// - LaTeX: a label inside the braces of any \...ref command (\ref, \eqref, \cref{a,b}, \autoref,
//   \nameref, ...) or the brackets of \hyperref[...]; a key inside the braces of any \...cite...
//   command (\cite, \citep, \parencite, \textcite, \citeauthor, \nocite, ...), after its optional
//   arguments. In a list, only the whole name between commas.
// - Typst: @name, and <name> (a label, or cite(<name>) / ref(<name>)). Labels and keys share the
//   syntax there. A full stop after @name ends the sentence, not the name.
import type { ReplaceSpec } from '$lib/search/replaceInFiles';

export type UseKind = 'label' | 'cite';
export type UseLanguage = 'latex' | 'typst';

/** the language whose uses a file holds, by its extension; null for a file that holds none */
export function useLanguageOf(path: string): UseLanguage | null {
	const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();
	if (ext === 'tex' || ext === 'ltx' || ext === 'sty' || ext === 'cls') return 'latex';
	if (ext === 'typ') return 'typst';
	return null;
}

/** a regex (source) matching each use of `name` as a `kind` in a file of `lang` */
export function usePattern(kind: UseKind, name: string, lang: UseLanguage): string {
	const n = escapeRe(name);
	if (lang === 'typst') return `(?<=(?<![\\w@])@)${n}(?![\\w:-]|\\.\\w)|(?<=<)${n}(?=>)`;
	// the name alone in its list: a brace, a comma or a space on either side
	const alone = `(?<![^{,\\s])${n}(?![^},\\s])`;
	if (kind === 'label') return `(?<=\\\\[A-Za-z]*ref\\*?\\{[^{}]*?)${alone}|(?<=\\\\hyperref\\[\\s*)${n}(?=\\s*\\])`;
	return `(?<=\\\\[A-Za-z]*cite[A-Za-z]*\\*?(?:\\s*\\[[^\\]]*\\])*\\s*\\{[^{}]*?)${alone}`;
}

/** the replace that renames `from`'s uses to `to` in a file of `lang` */
export function renameSpec(kind: UseKind, from: string, to: string, lang: UseLanguage): ReplaceSpec {
	// a regex replacement reads $ as a group reference; the new name is literal
	return { query: usePattern(kind, from, lang), replacement: to.replace(/\$/g, '$$$$'), regex: true, caseSensitive: true };
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
