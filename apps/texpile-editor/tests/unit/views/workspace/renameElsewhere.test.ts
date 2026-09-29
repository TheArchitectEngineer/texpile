// @vitest-environment jsdom
//
// A rename in the open file following its uses into the project's other files: which files are
// asked about, what they become, and how a settings panel's keystroke-by-keystroke rename is
// carried out once, as the whole chain.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toasts: { kind: string; title: string }[] = [];
vi.mock('$lib/modals/toaster-svelte', () => ({
	toaster: Object.fromEntries(
		['success', 'info', 'warning', 'error'].map((kind) => [kind, (t: { title: string }) => toasts.push({ kind, title: t.title })])
	)
}));

import { makeRenameElsewhere, type RenameElsewhereDeps } from '../../../../src/views/workspace/workspaceReplace';
import { FileHistory } from '$lib/workspace/fileHistory.svelte';
import { replaceInText } from '$lib/search/replaceInFiles';

function project(files: Record<string, string>) {
	const disk = new Map(Object.entries(files));
	const history = new FileHistory();
	const search = vi.fn(async (_root: string, query: string) => {
		const re = new RegExp(query);
		return {
			results: [...disk]
				.filter(([, text]) => text.split('\n').some((l) => re.test(l)))
				.map(([file]) => ({ file, rel: file, matches: [{ line: 1, text: '' }] }))
		};
	});
	const d = {
		provider: () => ({
			readSource: async (p: string) => ({ text: disk.get(p)!, encoding: 'utf8' }),
			writeText: async (p: string, t: string) => void disk.set(p, t)
		}),
		doc: { path: null },
		modes: { mode: 'source' },
		kind: () => 'tex',
		parseVisual: async () => null,
		saver: () => ({ flushAndWait: async () => {} }),
		history: () => history,
		reloadOpen: async () => {},
		root: () => '/p',
		search
	} as unknown as RenameElsewhereDeps;
	return { disk, history, search, rename: makeRenameElsewhere(d) };
}

beforeEach(() => {
	vi.useFakeTimers();
	toasts.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('makeRenameElsewhere', () => {
	it("renames a label's references in the other files once the renaming stops, and offers it as one undo", async () => {
		const { disk, history, rename } = project({
			'/p/ch1.tex': '\\label{fig:a} see \\ref{fig:a}',
			'/p/ch2.tex': 'As \\cref{fig:a,fig:b} show.',
			'/p/notes.md': 'fig:a'
		});
		rename('label', 'fig:a', 'fig:results');
		await vi.advanceTimersByTimeAsync(1000);
		expect(disk.get('/p/ch1.tex')).toBe('\\label{fig:a} see \\ref{fig:results}');
		expect(disk.get('/p/ch2.tex')).toBe('As \\cref{fig:results,fig:b} show.');
		expect(disk.get('/p/notes.md')).toBe('fig:a');
		expect(toasts).toEqual([{ kind: 'success', title: 'Also updated 2 references in 2 files' }]);
		expect(history.undoLabel).toBe('Rename fig:a to fig:results in Other Files');
	});

	it('carries out a keystroke-by-keystroke rename once, from the first name to the last', async () => {
		const { disk, search, rename } = project({ '/p/ch2.tex': 'See \\ref{fig:a}.' });
		for (const [from, to] of [
			['fig:a', 'fig:'],
			['fig:', 'fig:r'],
			['fig:r', 'fig:re'],
			['fig:re', 'fig:res']
		])
			rename('label', from, to);
		await vi.advanceTimersByTimeAsync(1000);
		expect(disk.get('/p/ch2.tex')).toBe('See \\ref{fig:res}.');
		// one lookup per language, for the first name only
		expect(search).toHaveBeenCalledTimes(2);
		expect(
			replaceInText('\\ref{fig:a}', { query: search.mock.calls[0][1], replacement: 'x', regex: true, caseSensitive: true }).count
		).toBe(1);
	});

	it('follows a citation key into LaTeX and Typst files, each in its own syntax', async () => {
		const { disk, rename } = project({ '/p/a.tex': '\\citep{knuth84}', '/p/b.typ': 'As @knuth84 wrote' });
		rename('cite', 'knuth84', 'knuth1984');
		await vi.advanceTimersByTimeAsync(1000);
		expect(disk.get('/p/a.tex')).toBe('\\citep{knuth1984}');
		expect(disk.get('/p/b.typ')).toBe('As @knuth1984 wrote');
		expect(toasts[0].title).toBe('Also updated 2 citations in 2 files');
	});

	it('says nothing when no other file uses the name', async () => {
		const { rename } = project({ '/p/a.tex': 'nothing here' });
		rename('label', 'fig:a', 'fig:b');
		await vi.advanceTimersByTimeAsync(1000);
		expect(toasts).toEqual([]);
	});
});
