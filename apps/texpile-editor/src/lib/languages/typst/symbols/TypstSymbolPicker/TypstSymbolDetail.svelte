<script lang="ts">
	import { typstSymbolPicker as picker } from '../typstSymbolPicker.svelte';
	import TypstSymbolGlyph from './TypstSymbolGlyph.svelte';
	import { m } from '$lib/paraglide/messages';

	const symbol = $derived(picker.activeSymbol);
</script>

<div class="border-surface-200-800 flex min-h-16 items-center gap-3 border-t px-3 py-2">
	{#if symbol}
		<div class="flex size-12 shrink-0 items-center justify-center text-4xl"><TypstSymbolGlyph {symbol} /></div>
		<div class="min-w-0 flex-1">
			<div class="truncate font-mono text-sm">{symbol.name}</div>
			{#if symbol.unicodeName}<div class="text-muted truncate text-xs">{symbol.unicodeName}</div>{/if}
			{#if symbol.mathShorthand}
				<div class="text-muted text-xs">{m.typst_symbols_math_shorthand()} <code class="font-mono">{symbol.mathShorthand}</code></div>
			{/if}
		</div>
		<div class="text-muted flex shrink-0 items-center gap-1.5 text-xs">
			{m.typst_symbols_inserts()}
			<code class="bg-surface-200-800 max-w-48 truncate rounded-base px-1.5 py-0.5 font-mono text-sm whitespace-pre"
				>{picker.insertionText(symbol)}</code
			>
		</div>
	{/if}
</div>
