// Two entries for one paper: the same DOI, or the same arXiv number, under different keys. A
// document that cites both lists the paper twice.
//
// Only these two are taken as proof. A title is shared by two editions of a book and by a chapter
// named after its book, and an ISBN by every chapter of a book, so neither says two entries are
// one work. A preprint and the version a journal published have different DOIs, and are left
// alone for the same reason: nothing in the entries says they are the same paper.
import type { BiblatexReference } from './types';

export type SameWork = { key: string; by: 'doi' | 'arxiv' };

// the modern number (1706.03762) and the old archive/number form (hep-th/9711200)
const ARXIV_ID = String.raw`(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?`;

function text(ref: BiblatexReference, field: string): string {
	const v = ref[field];
	return typeof v === 'string' ? v.trim() : '';
}

/** the DOI and the arXiv number an entry carries, as ids that compare equal for one work */
export function workIds(ref: BiblatexReference): { by: SameWork['by']; id: string }[] {
	const ids: { by: SameWork['by']; id: string }[] = [];
	const doi = text(ref, 'doi')
		.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
		.toLowerCase();
	if (/^10\.\d{4,9}\/\S+$/.test(doi)) ids.push({ by: 'doi', id: doi });

	const arxiv = arxivId(ref, doi);
	if (arxiv) ids.push({ by: 'arxiv', id: arxiv });
	return ids;
}

function arxivId(ref: BiblatexReference, doi: string): string | null {
	// arXiv's own DOI for a preprint: 10.48550/arXiv.1706.03762
	const fromDoi = /^10\.48550\/arxiv\.(.+)$/.exec(doi)?.[1];
	if (fromDoi) return fromDoi.replace(/v\d+$/, '');
	const type = (text(ref, 'eprinttype') || text(ref, 'archiveprefix')).toLowerCase();
	const eprint = text(ref, 'eprint').replace(/^arxiv:\s*/i, '');
	if (eprint && (type === 'arxiv' || (!type && new RegExp(`^${ARXIV_ID}$`).test(eprint)))) {
		const m = new RegExp(`^${ARXIV_ID}$`).exec(eprint);
		if (m) return m[1];
	}
	const url = new RegExp(`arxiv\\.org/(?:abs|pdf)/${ARXIV_ID}`, 'i').exec(text(ref, 'url'));
	if (url) return url[1];
	// how Google Scholar writes a preprint: journal = {arXiv preprint arXiv:1810.04805}
	for (const field of ['journal', 'journaltitle', 'note', 'howpublished']) {
		const m = new RegExp(`\\barxiv:\\s*${ARXIV_ID}`, 'i').exec(text(ref, field));
		if (m) return m[1];
	}
	return null;
}

/** the other entries that are the same work as `ref`, found by a DOI or an arXiv number they share */
export function sameWorkAs(ref: BiblatexReference, others: readonly BiblatexReference[]): SameWork[] {
	const mine = workIds(ref);
	if (!mine.length) return [];
	const found = new Map<string, SameWork>();
	for (const other of others) {
		if (other === ref || other.key === ref.key) continue;
		const theirs = workIds(other);
		const shared = mine.find((a) => theirs.some((b) => a.by === b.by && a.id === b.id));
		if (shared && !found.has(other.key)) found.set(other.key, { key: other.key, by: shared.by });
	}
	return [...found.values()];
}

/** for every entry that has a twin, the entries it is the same work as */
export function sameWorkIn(refs: readonly BiblatexReference[]): Map<string, SameWork[]> {
	const byId = new Map<string, BiblatexReference[]>();
	for (const ref of refs) {
		for (const { by, id } of workIds(ref)) {
			const k = `${by}:${id}`;
			const list = byId.get(k);
			if (list) list.push(ref);
			else byId.set(k, [ref]);
		}
	}
	const out = new Map<string, SameWork[]>();
	for (const group of byId.values()) {
		if (group.length < 2) continue;
		for (const ref of group) if (!out.has(ref.key)) out.set(ref.key, sameWorkAs(ref, refs));
	}
	return out;
}
