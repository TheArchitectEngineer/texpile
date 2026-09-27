// Which citation keys the folder's documents use, for the bibliography editor's "not cited" note:
// an entry nothing cites is left out of the bibliography.
//
// Read when that editor asks (it opens, the folder changes while it is open), not with the
// references on every save: it reads every document in the folder. A key counts as cited wherever
// it appears in a citation, a commented-out one included - the note says an entry is unused only
// when that is certain.
import { box } from '$lib/runes/box.svelte';
import { workspaceRoot } from './workspaceStore';
import { readTextFile, scanFiles } from './fileSystem';
import type { ReferencesFs } from './citations';

export type CitedKeys = {
	keys: ReadonlySet<string>;
	/** \nocite{*}, or Typst's bibliography(full: true): every entry is in the bibliography */
	all: boolean;
};

/** the folder's citations, or null before they are read, or where there is no document to read */
export const citedKeys = box<CitedKeys | null>(null);

// \cite, \citep, \Citet, \parencite, \textcite, \nocite, \cites{a}{b}, ...: the command, its
// optional arguments, then every braced group that follows (a multicite has one per work)
const LATEX_CITE = /\\(?:[A-Za-z]*[Cc]ite[A-Za-z]*|bibentry)\*?(?:\s*\[[^\]]*\])*\s*((?:\{[^{}]*\}(?:\s*\[[^\]]*\])*\s*)+)/g;
// Typst: @key (not inside a word or an address), cite(<key>) and cite(label("key"))
const TYPST_AT = /(?<![\w@])@(\w[\w:.-]*)/g;
const TYPST_CITE = /cite\(\s*(?:<([^>\s]+)>|label\(\s*"([^"]+)"\s*\))/g;

/** the keys `text` cites, in the syntax of `lang` */
export function citationsIn(text: string, lang: 'latex' | 'typst'): CitedKeys {
	const keys = new Set<string>();
	let all = false;
	if (lang === 'latex') {
		for (const m of text.matchAll(LATEX_CITE)) {
			for (const group of m[1].matchAll(/\{([^{}]*)\}/g)) {
				for (const key of group[1].split(',')) {
					const k = key.trim();
					if (k === '*') all = true;
					else if (k) keys.add(k);
				}
			}
		}
	} else {
		// a sentence's full stop after @key is not part of it
		for (const m of text.matchAll(TYPST_AT)) keys.add(m[1].replace(/[.:]+$/, ''));
		for (const m of text.matchAll(TYPST_CITE)) keys.add(m[1] ?? m[2]);
		if (/bibliography\([^)]*\bfull\s*:\s*true/.test(text)) all = true;
	}
	return { keys, all };
}

function languageOf(name: string): 'latex' | 'typst' | null {
	const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
	if (ext === 'tex' || ext === 'ltx') return 'latex';
	if (ext === 'typ') return 'typst';
	return null;
}

let fs: ReferencesFs = { scan: (r, e) => scanFiles(r, e).then((x) => x.files), read: readTextFile };

/** read the documents through `through` (a shared session's files live in the session, not on disk) */
export function readCitationsThrough(through: ReferencesFs): void {
	fs = through;
}

let seq = 0;

/** reads the citations of every document in the folder into citedKeys */
export async function loadCitedKeys(root: string | null = workspaceRoot.current): Promise<void> {
	const my = ++seq;
	if (!root) {
		citedKeys.current = null;
		return;
	}
	try {
		const files = (await fs.scan(root, ['tex', 'ltx', 'typ'])).filter((f) => languageOf(f.name));
		const keys = new Set<string>();
		let all = false;
		for (const f of files) {
			let text: string;
			try {
				text = await fs.read(f.path);
			} catch {
				continue; // unreadable: it cites nothing we can see
			}
			const found = citationsIn(text, languageOf(f.name)!);
			for (const k of found.keys) keys.add(k);
			all ||= found.all;
		}
		if (my !== seq) return;
		// with no document to read, "cited nowhere" would be true of every entry and tell nobody anything
		citedKeys.current = files.length ? { keys, all } : null;
	} catch {
		if (my === seq) citedKeys.current = null;
	}
}
