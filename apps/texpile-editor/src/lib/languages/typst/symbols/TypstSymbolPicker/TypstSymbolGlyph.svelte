<script lang="ts">
	import { invisibleSymbolLabel, typstSymbolGlyphText } from '../typstSymbolLabels';
	import type { TypstSymbol } from '../typstSymbol.types';

	let { symbol, class: className = '' }: { symbol: TypstSymbol; class?: string } = $props();
</script>

{#if symbol.invisible}
	<span class="text-muted border-surface-400-600 max-w-full truncate rounded-base border border-dashed px-0.5 font-mono text-xs">
		{invisibleSymbolLabel(symbol)}
	</span>
{:else}
	<span class="glyph {className}">{typstSymbolGlyphText(symbol)}</span>
{/if}

<style>
	/* the math faces the platforms ship come first, so an arrow or a relation looks the way it will
	   typeset and near-identical ones stay apart; the system's symbol and emoji fonts fill in the rest */
	.glyph {
		font-family:
			'STIX Two Math', 'Cambria Math', 'Latin Modern Math', 'New Computer Modern Math', 'Noto Sans Math', 'Segoe UI Symbol',
			'Apple Symbols', serif;
		line-height: 1;
	}
</style>
