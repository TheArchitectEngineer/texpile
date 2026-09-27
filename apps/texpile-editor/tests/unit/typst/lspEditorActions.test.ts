// @vitest-environment jsdom
//
// The tinymist features drawn outside the CodeMirror client, against a real LSPClient talking to a
// scripted server: where F12 lands for each shape of answer tinymist sends, the colour swatches it
// places, and which quick fixes can be applied here.
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { LSPClient, LSPPlugin, type Transport } from '@codemirror/lsp-client';
import { typstLanguage } from '$lib/languages/typst/source/typstLanguage';
import { typstGoTo } from '$lib/languages/typst/intellisense/goToDefinition';
import { actionPlan, snippetText } from '$lib/languages/typst/intellisense/quickFix';
import { choosePresentation, typstColorSwatches } from '$lib/languages/typst/intellisense/colorSwatches';

// jsdom lays nothing out; CodeMirror measures ranges when it scrolls a jump into view
if (!Range.prototype.getClientRects) {
	Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const URI = 'file:///p/main.typ';
type Req = { id?: number; method?: string; params?: { position?: { line: number; character: number } } };

/** a server that answers each method from `answers`, by function or by value */
function fakeServer(answers: Record<string, unknown | ((req: Req) => unknown)>): Transport {
	const handlers = new Set<(v: string) => void>();
	return {
		send(message: string) {
			const msg = JSON.parse(message) as Req;
			if (msg.id === undefined) return;
			const a = msg.method === 'initialize' ? { capabilities: { textDocumentSync: 2 } } : answers[msg.method!];
			const result = typeof a === 'function' ? (a as (r: Req) => unknown)(msg) : (a ?? null);
			queueMicrotask(() => handlers.forEach((h) => h(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))));
		},
		subscribe: (h) => void handlers.add(h),
		unsubscribe: (h) => void handlers.delete(h)
	};
}

let view: EditorView | null = null;
afterEach(() => {
	view?.destroy();
	view = null;
});

async function editor(doc: string, answers: Record<string, unknown | ((req: Req) => unknown)>, opened: [string, number][] = []) {
	const client = new LSPClient({ rootUri: 'file:///p' }).connect(fakeServer(answers));
	await client.initializing;
	view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: [
				typstLanguage(),
				LSPPlugin.create(client, URI, 'typst'),
				typstGoTo({ onOpenFileAt: (f, l) => opened.push([f, l]) }),
				typstColorSwatches()
			]
		}),
		parent: document.body
	});
	return view;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

function pressF12(v: EditorView, at: number): void {
	v.dispatch({ selection: { anchor: at } });
	v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }));
}

describe('F12', () => {
	it('moves the caret to a definition in the same file, from a LocationLink', async () => {
		const doc = '#let helper() = [hi]\n#helper()\n';
		const v = await editor(doc, {
			'textDocument/definition': [
				{ targetUri: URI, targetSelectionRange: { start: { line: 0, character: 5 }, end: { line: 0, character: 11 } } }
			]
		});
		pressF12(v, doc.indexOf('#helper()') + 2);
		await settle();
		expect(v.state.selection.main.head).toBe(5);
	});

	it('opens the file a definition lives in, at its line', async () => {
		const opened: [string, number][] = [];
		const v = await editor(
			'#import "lib.typ": helper\n#helper()\n',
			{
				'textDocument/definition': [
					{ uri: 'file:///p/lib.typ', range: { start: { line: 3, character: 5 }, end: { line: 3, character: 11 } } }
				]
			},
			opened
		);
		pressF12(v, 28);
		await settle();
		expect(opened).toEqual([['/p/lib.typ', 4]]);
	});

	it('falls back to the linked file for a path with no definition, like an image', async () => {
		const opened: [string, number][] = [];
		const v = await editor(
			'#image("fig.png")\n',
			{
				'textDocument/definition': null,
				'textDocument/documentLink': [
					{ range: { start: { line: 0, character: 7 }, end: { line: 0, character: 16 } }, target: 'file:///p/fig.png' }
				]
			},
			opened
		);
		pressF12(v, 10);
		await settle();
		expect(opened).toEqual([['/p/fig.png', 1]]);
	});

	it('does nothing when the server knows nothing there', async () => {
		const opened: [string, number][] = [];
		const v = await editor('Plain words.\n', { 'textDocument/definition': null, 'textDocument/documentLink': [] }, opened);
		pressF12(v, 3);
		await settle();
		expect(opened).toEqual([]);
		expect(v.state.selection.main.head).toBe(3);
	});
});

describe('colour swatches', () => {
	it('draws one before each colour the server reports', async () => {
		const v = await editor('#rect(fill: rgb("#ff0000"))\n', {
			'textDocument/documentColor': [
				{ range: { start: { line: 0, character: 12 }, end: { line: 0, character: 26 } }, color: { red: 1, green: 0, blue: 0, alpha: 1 } }
			]
		});
		await settle();
		const swatches = v.dom.querySelectorAll<HTMLElement>('.cm-typst-swatch');
		expect(swatches).toHaveLength(1);
		// jsdom writes an opaque rgba() back as rgb()
		expect(swatches[0].style.backgroundColor).toBe('rgb(255, 0, 0)');
	});
});

describe('colour swatches, late server', () => {
	it('appear once the LSP extension is added to an editor already showing', async () => {
		const client = new LSPClient({ rootUri: 'file:///p' }).connect(
			fakeServer({
				'textDocument/documentColor': [
					{ range: { start: { line: 0, character: 11 }, end: { line: 0, character: 14 } }, color: { red: 0, green: 0, blue: 1, alpha: 1 } }
				]
			})
		);
		await client.initializing;
		const lsp = new Compartment();
		view = new EditorView({
			state: EditorState.create({ doc: '#box(fill: blue)\n', extensions: [typstLanguage(), lsp.of([]), typstColorSwatches()] }),
			parent: document.body
		});
		await settle();
		expect(view.dom.querySelectorAll('.cm-typst-swatch')).toHaveLength(0);
		view.dispatch({ effects: lsp.reconfigure(LSPPlugin.create(client, URI, 'typst')) });
		await settle();
		expect(view.dom.querySelectorAll('.cm-typst-swatch')).toHaveLength(1);
	});
});

describe('actionPlan', () => {
	const edit = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: '==' };

	it('takes an action whose edits are all to this document', () => {
		expect(actionPlan({ title: 'Increase depth of heading', edit: { changes: { [URI]: [edit] } } }, URI)).toEqual({
			edits: [edit],
			creates: []
		});
	});

	it('takes a file creation, as a path', () => {
		const create = { title: 'Create missing file', edit: { documentChanges: [{ kind: 'create' as const, uri: 'file:///p/missing.typ' }] } };
		expect(actionPlan(create, URI)).toEqual({ edits: [], creates: ['/p/missing.typ'] });
	});

	it('refuses an action that edits another file or deletes one, rather than applying half of it', () => {
		expect(actionPlan({ title: 'x', edit: { changes: { [URI]: [edit], 'file:///p/other.typ': [edit] } } }, URI)).toBeNull();
		expect(actionPlan({ title: 'x', edit: { documentChanges: [{ kind: 'delete' as const, uri: 'file:///p/a.typ' }] } }, URI)).toBeNull();
		expect(actionPlan({ title: 'a command, no edit' }, URI)).toBeNull();
	});
});

describe('snippetText', () => {
	it('keeps placeholders and drops tab stops', () => {
		expect(snippetText('figure(\n  caption: [${1:Caption}],\n  image("fig.png")\n)$0')).toBe(
			'figure(\n  caption: [Caption],\n  image("fig.png")\n)'
		);
		expect(snippetText('a$1b${2}c')).toBe('abc');
	});
});

describe('choosePresentation', () => {
	// what tinymist 0.15 answers for #0080ff, in its order
	const labels = [
		'"#0080ff"',
		'rgb("#0080ff")',
		'luma(51.19%)',
		'oklab(61.41%, -0.05, -0.205)',
		'oklch(61.41%, 0.211, 256.22deg)',
		'cmyk(100%, 50%, 0%, 0%)'
	];
	const blue = { red: 0, green: 0.5, blue: 1, alpha: 1 };

	it('keeps the form the literal is written in', () => {
		expect(choosePresentation('rgb("#ff0000")', labels, blue)).toBe('rgb("#0080ff")');
		expect(choosePresentation('oklch(50%, 0.1, 20deg)', labels, blue)).toBe('oklch(61.41%, 0.211, 256.22deg)');
		expect(choosePresentation('cmyk(0%, 0%, 0%, 100%)', labels, blue)).toBe('cmyk(100%, 50%, 0%, 0%)');
	});

	it('never puts the bare string in place of a colour', () => {
		expect(choosePresentation('red', labels, blue)).toBe('rgb("#0080ff")');
	});

	it('leaves luma for rgb when the new colour is not grey', () => {
		expect(choosePresentation('luma(50%)', labels, blue)).toBe('rgb("#0080ff")');
		expect(choosePresentation('luma(50%)', ['rgb("#808080")', 'luma(50%)'], { red: 0.5, green: 0.5, blue: 0.5, alpha: 1 })).toBe(
			'luma(50%)'
		);
	});
});
