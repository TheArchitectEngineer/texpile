// A swatch beside each colour literal in Typst source, which opens the platform's colour picker.
import { LSPPlugin } from '@codemirror/lsp-client';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { Extension, Text } from '@codemirror/state';
import { m } from '$lib/paraglide/messages';
import type { LspRange } from './lspRange.types';

const SWATCH_THEME = EditorView.baseTheme({
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

type Color = { red: number; green: number; blue: number; alpha: number };
type ColorLiteral = { range: LspRange; color: Color };

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
	return [plugin, SWATCH_THEME];
}
