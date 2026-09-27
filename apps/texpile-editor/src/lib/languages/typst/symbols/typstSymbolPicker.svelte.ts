// The Typst symbol picker's state: one picker for the window, opened from the source toolbar, the
// Insert menu and the command palette alike, and inserting where the caret was when it opened.
import type { EditorView as CMView } from '@codemirror/view';
import type { EditorView as PMView } from 'prosemirror-view';
import { editorViewStore, sourceCmView, viewMode } from '$lib/stores/editorStore';
import { searchTypstSymbols } from './typstSymbolSearch';
import { computeTypstSymbolInsert, typstSymbolSourceText } from './typstSymbolInsert';
import { insertTypstSymbolVisual, typstSymbolVisualInsertion } from './typstSymbolVisualInsert';
import { recentTypstSymbolNames, rememberTypstSymbol } from './typstSymbolRecents';
import type { TypstSymbol, TypstSymbolGroup } from './typstSymbol.types';

/** tiles per row; the arrow keys move by it, so the grid is laid out at exactly this */
export const TYPST_SYMBOL_COLUMNS = 10;
// past this the matches are too loose to be worth scrolling through
const MAX_SEARCH_RESULTS = 200;
const FIRST_GROUP: TypstSymbolGroup = 'greek';

export type TypstSymbolTab = TypstSymbolGroup | 'recent';

type SymbolTarget = { kind: 'source'; view: CMView } | { kind: 'visual'; view: PMView };
type SymbolCatalog = { list: readonly TypstSymbol[]; byName: (name: string) => TypstSymbol | undefined };

/** the editor a picked symbol goes into: the source view in source mode, the visual one otherwise */
function editorTarget(): SymbolTarget | null {
	if (viewMode.current === 'source') {
		const cm = sourceCmView.current;
		return cm && cm.dom.isConnected ? { kind: 'source', view: cm } : null;
	}
	const pm = editorViewStore.current;
	return pm && pm.dom.isConnected ? { kind: 'visual', view: pm } : null;
}

class TypstSymbolPickerState {
	open = $state(false);
	query = $state('');
	tab = $state<TypstSymbolTab>(FIRST_GROUP);
	active = $state(0);
	/** the table, loaded on first open: it is too big to ship with the editor for a dialog few open */
	catalog = $state.raw<SymbolCatalog | null>(null);
	/** read, never rendered: where the caret was when the picker opened */
	private target: SymbolTarget | null = null;

	readonly recent = $derived.by((): readonly TypstSymbol[] => {
		const catalog = this.catalog;
		if (!catalog) return [];
		return recentTypstSymbolNames()
			.map(catalog.byName)
			.filter((s): s is TypstSymbol => s !== undefined);
	});

	readonly results = $derived.by((): readonly TypstSymbol[] => {
		const catalog = this.catalog;
		if (!catalog) return [];
		if (this.query.trim()) return searchTypstSymbols(catalog.list, this.query, recentTypstSymbolNames()).slice(0, MAX_SEARCH_RESULTS);
		if (this.tab === 'recent') return this.recent;
		const tab = this.tab;
		return catalog.list.filter((s) => s.group === tab);
	});

	readonly activeSymbol = $derived<TypstSymbol | null>(this.results[this.active] ?? null);

	async show(): Promise<void> {
		const target = editorTarget();
		if (!target) return;
		if (!this.catalog) {
			const { typstSymbolList, typstSymbolByName } = await import('./typstSymbols');
			this.catalog = { list: typstSymbolList(), byName: typstSymbolByName };
		}
		this.target = target;
		this.query = '';
		this.active = 0;
		this.tab = this.recent.length > 0 ? 'recent' : FIRST_GROUP;
		this.open = true;
	}

	/** close without inserting, the caret back where it was */
	close(): void {
		const target = this.target;
		this.open = false;
		this.target = null;
		target?.view.focus();
	}

	search(query: string): void {
		this.query = query;
		this.active = 0;
	}

	selectTab(tab: TypstSymbolTab): void {
		this.tab = tab;
		this.query = '';
		this.active = 0;
	}

	choose(symbol: TypstSymbol): void {
		const target = this.target;
		this.open = false;
		this.target = null;
		if (!target || !target.view.dom.isConnected) return;
		if (target.kind === 'source') {
			target.view.dispatch(computeTypstSymbolInsert(target.view.state, symbol));
			target.view.focus();
		} else insertTypstSymbolVisual(target.view, symbol);
		rememberTypstSymbol(symbol.name);
	}

	/** what choosing `symbol` would write at the caret */
	insertionText(symbol: TypstSymbol): string {
		const target = this.target;
		if (!target) return symbol.value;
		return target.kind === 'source'
			? typstSymbolSourceText(target.view.state, symbol)
			: typstSymbolVisualInsertion(target.view.state.tr, symbol).text;
	}
}

export const typstSymbolPicker = new TypstSymbolPickerState();
