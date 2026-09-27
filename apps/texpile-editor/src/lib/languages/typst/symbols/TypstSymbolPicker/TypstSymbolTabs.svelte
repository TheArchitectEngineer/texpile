<script lang="ts">
	import { TYPST_SYMBOL_GROUPS, typstSymbolGroupLabel } from '../typstSymbolGroups';
	import { typstSymbolPicker as picker, type TypstSymbolTab } from '../typstSymbolPicker.svelte';
	import { tabStep } from '../typstSymbolPickerKeys';
	import { m } from '$lib/paraglide/messages';

	let { controls }: { controls: string } = $props();

	const tabs = $derived<TypstSymbolTab[]>(picker.recent.length > 0 ? ['recent', ...TYPST_SYMBOL_GROUPS] : [...TYPST_SYMBOL_GROUPS]);
	// a search spans every tab, so none is the one showing
	const searching = $derived(picker.query.trim() !== '');

	function labelOf(tab: TypstSymbolTab): string {
		return tab === 'recent' ? m.typst_symbols_group_recent() : typstSymbolGroupLabel(tab);
	}

	/** the arrows walk the tabs and show each, as a tab list does */
	function onKeydown(e: KeyboardEvent) {
		const next = tabStep(e.key, tabs.indexOf(picker.tab), tabs.length);
		if (next === null) return;
		e.preventDefault();
		picker.selectTab(tabs[next]);
		(e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${tabs[next]}"]`)?.focus();
	}
</script>

<div
	class="border-surface-200-800 flex flex-wrap gap-0.5 border-b p-1.5"
	role="tablist"
	aria-label={m.typst_symbols_categories_aria()}
	tabindex="-1"
	onkeydown={onKeydown}
>
	{#each tabs as tab (tab)}
		{@const selected = !searching && picker.tab === tab}
		<button
			type="button"
			role="tab"
			class="btn btn-xs"
			class:preset-tonal-primary={selected}
			class:hover:preset-tonal={!selected}
			data-tab={tab}
			aria-selected={selected}
			aria-controls={controls}
			tabindex={picker.tab === tab ? 0 : -1}
			onclick={() => picker.selectTab(tab)}
		>
			{labelOf(tab)}
		</button>
	{/each}
</div>
