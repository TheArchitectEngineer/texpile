<script lang="ts">
	// The bar over a file holding places a merge marked: how many are left to choose and how, then,
	// once none is, where the merge is finished and the way back to the visual editor.
	import { GitMerge } from '@lucide/svelte';
	import { m } from '$lib/paraglide/messages';

	let { left, onLeave }: { left: number; onLeave?: () => void } = $props();
</script>

<div
	class="border-surface-200-800 bg-surface-100-900 text-muted flex min-h-10 shrink-0 items-center gap-2 border-b px-3 text-xs"
	role="status"
>
	<GitMerge class="text-warning-ink size-3.5 shrink-0" />
	{#if left}
		<p class="min-w-0 truncate">
			<span class="font-medium">{m.vcs_conflict_notice_title()}.</span>
			{left === 1 ? m.vcs_conflict_notice_one() : m.vcs_conflict_notice_count({ count: left })}
		</p>
	{:else}
		<p class="min-w-0 truncate">
			<span class="font-medium">{m.vcs_conflict_notice_done_title()}.</span>
			{m.vcs_conflict_notice_done()}
		</p>
		{#if onLeave}
			<button class="btn btn-xs preset-outlined-surface-200-800 hover:preset-tonal ml-auto shrink-0" onclick={onLeave}>
				{m.vcs_conflict_back_to_visual()}
			</button>
		{/if}
	{/if}
</div>
