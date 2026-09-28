<script lang="ts">
	import { typstSymbolPicker as picker, TYPST_SYMBOL_COLUMNS } from '../typstSymbolPicker.svelte';
	import { BACK_TO_SEARCH, gridStep } from '../typstSymbolPickerKeys';
	import { typstSymbolSpokenLabel } from '../typstSymbolLabels';
	import TypstSymbolGlyph from './TypstSymbolGlyph.svelte';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		id: string;
		optionId: (index: number) => string;
		/** hand the keyboard back to the search field: Up from the top row, or typing */
		onsearch: () => void;
	};

	let { id, optionId, onsearch }: Props = $props();

	let listbox = $state<HTMLElement | null>(null);

	export function focusActive(): void {
		document.getElementById(optionId(picker.active))?.focus();
	}

	// a new list starts at its top, where its first tile is the active one
	$effect(() => {
		void picker.results;
		if (listbox) listbox.scrollTop = 0;
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (picker.activeSymbol) picker.choose(picker.activeSymbol);
			return;
		}
		const next = gridStep(e.key, picker.active, picker.results.length, TYPST_SYMBOL_COLUMNS, e.ctrlKey || e.metaKey);
		if (next === null) {
			// focus moves before the key lands, so what was typed goes into the search field
			if ((e.key.length === 1 || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) onsearch();
			return;
		}
		e.preventDefault();
		if (next === BACK_TO_SEARCH) return onsearch();
		picker.active = next;
		focusActive();
	}
</script>

{#if picker.catalog && picker.results.length === 0}
	<div class="text-muted px-3 py-10 text-center text-sm">{m.typst_symbols_empty()}</div>
{:else}
	<div
		bind:this={listbox}
		{id}
		class="grid min-h-0 auto-rows-max gap-1 overflow-y-auto p-1.5 [scrollbar-gutter:stable]"
		style:grid-template-columns="repeat({TYPST_SYMBOL_COLUMNS}, minmax(0, 1fr))"
		role="listbox"
		tabindex="-1"
		aria-label={m.typst_symbols_results_aria()}
		onkeydown={onKeydown}
	>
		{#each picker.results as symbol, i (symbol.name)}
			<button
				type="button"
				id={optionId(i)}
				role="option"
				class="tile bg-surface-100-900 flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded-base border text-2xl"
				class:active={i === picker.active}
				aria-selected={i === picker.active}
				aria-label={typstSymbolSpokenLabel(symbol)}
				tabindex={i === picker.active ? 0 : -1}
				onpointermove={() => (picker.active = i)}
				onclick={() => picker.choose(symbol)}
			>
				<TypstSymbolGlyph {symbol} />
			</button>
		{/each}
	</div>
{/if}

<style>
	.tile {
		border-color: transparent;
		transition:
			background-color 0.15s,
			border-color 0.15s;
	}

	.tile.active {
		background: var(--math-key-hover);
		border-color: var(--math-key-edge);
	}

	.tile:active {
		background: var(--math-key-down);
	}
</style>
