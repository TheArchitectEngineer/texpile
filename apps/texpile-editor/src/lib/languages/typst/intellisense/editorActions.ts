// tinymist features the CodeMirror client has no UI for, drawn here: go to a definition or a file
// (F12 and Ctrl/Cmd-click, across files), quick fixes at the caret (Alt-Enter), and a colour swatch
// beside each colour literal that opens a picker.
//
// Each reaches the server through the editor's own LSPPlugin, so they work wherever the editor has
// one - the host's tinymist or, for a guest, the host's over the session - and do nothing where it
// has none (no tinymist, or the parser-only editors).
import { LSPPlugin } from '@codemirror/lsp-client';
import { syntaxTree } from '@codemirror/language';
import { forEachDiagnostic } from '@codemirror/lint';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { ChangeSpec, Extension, StateEffect, Text } from '@codemirror/state';
import { showContextMenu, type ContextMenuItem } from '$lib/menus/contextMenu.svelte';
import { createEntry, normalizePath, underRoot } from '$lib/workspace/fileSystem';
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import { m } from '$lib/paraglide/messages';
import { pathFromUri } from './lspClient';
import { relFromSessionUri } from './sessionUri';

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type TextEdit = { range: Range; newText: string; insertTextFormat?: number };

// --- go to definition ----------------------------------------------------------------------------

export type GoToHooks = {
	/** open another project file at a 1-based line */
	onOpenFileAt?: (file: string, line: number) => void;
	/** marks the line a jump in this file landed on, as the LaTeX jumps do */
	flash?: (pos: number) => StateEffect<unknown>;
};

/** a Location or a LocationLink, which tinymist sends whatever the client says it supports */
type Target = { uri?: string; range?: Range; targetUri?: string; targetSelectionRange?: Range; targetRange?: Range };
type DocumentLink = { range: Range; target?: string };

/** what the caret is on when a click could mean "take me there": a name, a path, a reference */
const NAVIGABLE = new Set(['Ident', 'MathIdent', 'Str', 'Ref', 'RefMarker', 'Label']);

function navigableAt(view: EditorView, pos: number): boolean {
	const tree = syntaxTree(view.state);
	return NAVIGABLE.has(tree.resolveInner(pos, 1).name) || NAVIGABLE.has(tree.resolveInner(pos, -1).name);
}

/**
 * Where the symbol or path at `pos` leads: its definition, else the file a path names. Asynchronous
 * - the caller has already said yes to the key or click by the time the server answers.
 */
async function goTo(view: EditorView, plugin: LSPPlugin, pos: number, hooks: GoToHooks): Promise<void> {
	const position = plugin.toPosition(pos);
	const textDocument = { uri: plugin.uri };
	const defs = await plugin.client.request<unknown, Target | Target[] | null>('textDocument/definition', { textDocument, position });
	const def = [defs ?? []].flat()[0];
	let uri = def?.targetUri ?? def?.uri;
	let at = def?.targetSelectionRange?.start ?? def?.targetRange?.start ?? def?.range?.start ?? { line: 0, character: 0 };
	if (!uri) {
		// an image, a bibliography: tinymist links those paths rather than defining them
		const links = await plugin.client.request<unknown, DocumentLink[] | null>('textDocument/documentLink', { textDocument });
		const hit = links?.find((l) => l.target && within(l.range, position));
		if (!hit?.target) return;
		uri = hit.target;
		at = { line: 0, character: 0 };
	}
	if (uri === plugin.uri) {
		const offset = plugin.fromPosition(at, view.state.doc);
		view.dispatch({
			selection: { anchor: offset },
			scrollIntoView: true,
			effects: hooks.flash?.(offset),
			userEvent: 'select.definition'
		});
		view.focus();
		return;
	}
	// a guest's answers name session files, which the workspace opens by their project path
	const file = /^file:/i.test(uri) ? pathFromUri(uri) : relFromSessionUri(uri);
	if (file) hooks.onOpenFileAt?.(file, at.line + 1);
}

function notBefore(a: Position, b: Position): boolean {
	return a.line > b.line || (a.line === b.line && a.character >= b.character);
}

function within(range: Range, p: Position): boolean {
	return notBefore(p, range.start) && notBefore(range.end, p);
}

function startGoTo(view: EditorView, pos: number, hooks: GoToHooks): boolean {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return false;
	plugin.client.sync();
	goTo(view, plugin, pos, hooks).catch((e) => plugin.reportError(m.typst_goto_failed(), e));
	return true;
}

/**
 * F12 and Ctrl/Cmd-click. Replaces the client's own F12, which reads only one of the two answer
 * shapes tinymist sends and cannot open another file. A click only counts on something that can
 * lead somewhere, so Ctrl/Cmd-click on plain words still adds a cursor.
 */
export function typstGoTo(hooks: GoToHooks): Extension {
	return [
		keymap.of([{ key: 'F12', run: (view) => startGoTo(view, view.state.selection.main.head, hooks), preventDefault: true }]),
		EditorView.domEventHandlers({
			mousedown(event, view) {
				if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
				const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
				if (pos == null || !navigableAt(view, pos)) return false;
				event.preventDefault();
				return startGoTo(view, pos, hooks);
			}
		})
	];
}

// --- quick fixes ---------------------------------------------------------------------------------

type ResourceOp = { kind: 'create' | 'rename' | 'delete'; uri?: string };
type DocumentEdit = { textDocument?: { uri?: string }; edits?: TextEdit[] };
type CodeAction = {
	title: string;
	edit?: { changes?: Record<string, TextEdit[]>; documentChanges?: (DocumentEdit | ResourceOp)[] };
};

export type QuickFixHooks = {
	/** create an empty file (a quick fix for a missing `#include` or image); host only */
	onCreateFile?: (path: string) => Promise<void>;
};

/**
 * A quick fix's new file, created empty - and only inside the open folder: the path is the
 * server's, and a fix is no reason to write anywhere else. Fails rather than overwriting, as the
 * server asked (`overwrite: false`).
 */
export async function createProjectFile(path: string): Promise<void> {
	const root = workspaceRoot.current;
	const target = normalizePath(path);
	if (!root || !underRoot(root, target)) return;
	await createEntry(target, 'file');
	// our own write: the tree shows the file now, not at the watcher's debounce
	dispatchEvent(new CustomEvent('texpile:fs-changed'));
}

/** the edits an action makes to THIS document, and the files it creates; null when it does anything else */
export function actionPlan(action: CodeAction, uri: string): { edits: TextEdit[]; creates: string[] } | null {
	const edits: TextEdit[] = [];
	const creates: string[] = [];
	for (const [target, list] of Object.entries(action.edit?.changes ?? {})) {
		if (target !== uri) return null;
		edits.push(...list);
	}
	for (const change of action.edit?.documentChanges ?? []) {
		if ('kind' in change) {
			if (change.kind !== 'create' || !change.uri || !/^file:/i.test(change.uri)) return null;
			creates.push(pathFromUri(change.uri));
		} else {
			if (change.textDocument?.uri !== uri) return null;
			edits.push(...(change.edits ?? []));
		}
	}
	return edits.length || creates.length ? { edits, creates } : null;
}

/** a snippet's text as plain text: `${1:Caption}` keeps its placeholder, `$0` and `$1` go */
export function snippetText(text: string): string {
	return text.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}|\$\d+/g, '');
}

function applyPlan(view: EditorView, plugin: LSPPlugin, plan: { edits: TextEdit[]; creates: string[] }, hooks: QuickFixHooks): void {
	if (plan.edits.length) {
		const changes: ChangeSpec[] = plan.edits.map((e) => ({
			from: plugin.fromPosition(e.range.start, view.state.doc),
			to: plugin.fromPosition(e.range.end, view.state.doc),
			insert: e.insertTextFormat === 2 ? snippetText(e.newText) : e.newText
		}));
		view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
	}
	for (const path of plan.creates) void hooks.onCreateFile?.(path);
	view.focus();
}

async function quickFix(view: EditorView, plugin: LSPPlugin, hooks: QuickFixHooks): Promise<void> {
	const { from, to, head } = view.state.selection.main;
	const range = { start: plugin.toPosition(from), end: plugin.toPosition(to) };
	// the fixes for a diagnostic are only offered when the diagnostic comes with the request
	const diagnostics: { range: Range; message: string; severity: number }[] = [];
	forEachDiagnostic(view.state, (d, dFrom, dTo) => {
		if (dFrom <= to && dTo >= from)
			diagnostics.push({
				range: { start: plugin.toPosition(dFrom), end: plugin.toPosition(dTo) },
				message: d.message,
				severity: d.severity === 'error' ? 1 : 2
			});
	});
	const actions = await plugin.client.request<unknown, CodeAction[] | null>('textDocument/codeAction', {
		textDocument: { uri: plugin.uri },
		range,
		context: { diagnostics }
	});
	const items: ContextMenuItem[] = [];
	for (const action of actions ?? []) {
		const plan = actionPlan(action, plugin.uri);
		// creating a file needs somewhere to create it; the rest of an action is all or nothing
		if (plan && (!plan.creates.length || hooks.onCreateFile))
			items.push({ label: action.title, onclick: () => applyPlan(view, plugin, plan, hooks) });
	}
	const at = view.coordsAtPos(head) ?? { left: 0, bottom: 0 };
	if (!items.length) items.push({ label: m.typst_quick_fix_none(), disabled: true });
	await showContextMenu(items, { x: at.left, y: at.bottom }, { onClose: () => view.focus() });
}

/** Alt-Enter: the fixes and rewrites tinymist offers where the caret is, as a menu */
export function typstQuickFix(hooks: QuickFixHooks): Extension {
	return keymap.of([
		{
			key: 'Alt-Enter',
			preventDefault: true,
			run(view) {
				const plugin = LSPPlugin.get(view);
				if (!plugin) return false;
				plugin.client.sync();
				quickFix(view, plugin, hooks).catch((e) => plugin.reportError(m.typst_quick_fix_failed(), e));
				return true;
			}
		}
	]);
}

// --- colour swatches -----------------------------------------------------------------------------

type Color = { red: number; green: number; blue: number; alpha: number };
type ColorLiteral = { range: Range; color: Color };

function hex(c: Color): string {
	return (
		'#' +
		[c.red, c.green, c.blue]
			.map((v) =>
				Math.round(Math.min(1, Math.max(0, v)) * 255)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

function fromHex(value: string, alpha: number): Color {
	const n = parseInt(value.slice(1), 16);
	return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255, alpha };
}

/**
 * Which of the server's spellings replaces a colour literal. tinymist offers the new colour in every
 * form it knows (`"#0080ff"`, `rgb("#0080ff")`, `luma(...)`, `oklch(...)`, ...) and first of all
 * as a bare string, which in place of a whole `rgb(...)` call would turn the colour into text. So:
 * the form the literal is already written in, else `rgb(...)` - and never `luma`, which is grey
 * only, for a colour that is not grey.
 */
export function choosePresentation(original: string, labels: string[], picked: Color): string | null {
	const grey = picked.red === picked.green && picked.green === picked.blue;
	const form = /^[\w.-]+\(/.exec(original.trim())?.[0];
	const same = form && (form !== 'luma(' || grey) ? labels.find((l) => l.startsWith(form)) : undefined;
	return same ?? labels.find((l) => l.startsWith('rgb(')) ?? null;
}

class SwatchWidget extends WidgetType {
	constructor(
		readonly literal: ColorLiteral,
		readonly pick: (literal: ColorLiteral, value: string) => void
	) {
		super();
	}
	override eq(other: SwatchWidget): boolean {
		return hex(other.literal.color) === hex(this.literal.color) && other.literal.color.alpha === this.literal.color.alpha;
	}
	// eslint-disable-next-line @typescript-eslint/naming-convention -- @codemirror WidgetType API method
	toDOM(): HTMLElement {
		const swatch = document.createElement('span');
		swatch.className = 'cm-typst-swatch';
		swatch.style.backgroundColor = `rgba(${[this.literal.color.red, this.literal.color.green, this.literal.color.blue].map((v) => Math.round(v * 255)).join(', ')}, ${this.literal.color.alpha})`;
		swatch.title = m.typst_pick_color();
		swatch.addEventListener('mousedown', (e) => {
			e.preventDefault();
			// the platform's own picker, which is where the user's saved colours live
			const input = document.createElement('input');
			input.type = 'color';
			input.value = hex(this.literal.color);
			input.addEventListener('change', () => this.pick(this.literal, input.value));
			input.click();
		});
		return swatch;
	}
	override ignoreEvent(): boolean {
		return false;
	}
}

const swatchTheme = EditorView.baseTheme({
	'.cm-typst-swatch': {
		display: 'inline-block',
		width: '0.75em',
		height: '0.75em',
		marginRight: '0.25em',
		verticalAlign: 'middle',
		borderRadius: '2px',
		outline: '1px solid color-mix(in srgb, currentColor 35%, transparent)',
		cursor: 'pointer'
	}
});

/** a swatch before each colour literal (`rgb("#ff0000")`, `red`); clicking one opens a picker */
export function typstColorSwatches(): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;
			private timer: ReturnType<typeof setTimeout> | null = null;
			private seq = 0;
			/** the document the swatches' ranges were measured in */
			private measured: Text | null = null;

			constructor(readonly view: EditorView) {
				this.schedule(0);
			}

			update(u: ViewUpdate): void {
				if (u.docChanged) {
					this.decorations = this.decorations.map(u.changes);
					this.schedule(400);
				} else if (u.transactions.some((tr) => tr.reconfigured)) {
					// the LSP extension arrives by reconfiguring the editor, after it has painted
					this.schedule(0);
				}
			}

			destroy(): void {
				if (this.timer) clearTimeout(this.timer);
			}

			private schedule(delay: number): void {
				if (this.timer) clearTimeout(this.timer);
				this.timer = setTimeout(() => void this.refresh(), delay);
			}

			private async refresh(): Promise<void> {
				const lsp = LSPPlugin.get(this.view);
				if (!lsp) return;
				const seq = ++this.seq;
				lsp.client.sync();
				const doc = this.view.state.doc;
				let colors: ColorLiteral[] | null;
				try {
					colors = await lsp.client.request<unknown, ColorLiteral[] | null>('textDocument/documentColor', {
						textDocument: { uri: lsp.uri }
					});
				} catch {
					return;
				}
				// typed over while the server answered: the next refresh is already scheduled
				if (seq !== this.seq || this.view.state.doc !== doc) return;
				const widgets = (colors ?? []).map((literal) =>
					Decoration.widget({ widget: new SwatchWidget(literal, (picked, value) => void this.pick(picked, value)), side: -1 }).range(
						lsp.fromPosition(literal.range.start, doc)
					)
				);
				this.decorations = Decoration.set(widgets, true);
				this.measured = doc;
				this.view.dispatch({});
			}

			private async pick(literal: ColorLiteral, value: string): Promise<void> {
				const lsp = LSPPlugin.get(this.view);
				// the text moved since the swatch was placed, so its range no longer names the literal;
				// the refresh already on its way places a fresh one
				if (!lsp || this.view.state.doc !== this.measured) return;
				lsp.client.sync();
				const color = fromHex(value, literal.color.alpha);
				const presentations = await lsp.client.request<unknown, { label: string }[] | null>('textDocument/colorPresentation', {
					textDocument: { uri: lsp.uri },
					color,
					range: literal.range
				});
				const doc = this.view.state.doc;
				if (doc !== this.measured) return;
				const from = lsp.fromPosition(literal.range.start, doc);
				const to = lsp.fromPosition(literal.range.end, doc);
				const insert = choosePresentation(
					doc.sliceString(from, to),
					(presentations ?? []).map((p) => p.label),
					color
				);
				if (insert) this.view.dispatch({ changes: { from, to, insert }, userEvent: 'input' });
			}
		},
		{ decorations: (v) => v.decorations }
	);
	return [plugin, swatchTheme];
}
