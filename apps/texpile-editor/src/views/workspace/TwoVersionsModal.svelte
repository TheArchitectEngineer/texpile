<script lang="ts">
	// Two saved copies of one file, read-only (twoVersions.svelte.ts): the older on the left, or
	// above in the inline layout, the same way the changes in a version are shown.
	import { onMount } from 'svelte';
	import { Columns2, Rows2, FileDiff } from '@lucide/svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import Modal from '$lib/modals/Modal.svelte';
	import { closeTwoVersions, type TwoVersions } from '$lib/workspace/twoVersions.svelte';
	import { layout as savedLayout } from '$lib/storage/layout';
	import DiffPanel from './DiffPanel.svelte';
	import { m } from '$lib/paraglide/messages';

	let { versions }: { versions: TwoVersions } = $props();

	let before = $state('');
	let after = $state('');
	let reading = $state(true);
	let binary = $state(false);
	let diffLayout = $state<'unified' | 'split'>(savedLayout.current.diffLayout === 'split' ? 'split' : 'unified');

	onMount(async () => {
		const [a, b] = await Promise.all([versions.before(), versions.after()]);
		before = a ?? '';
		after = b ?? '';
		// an image or a PDF: a line diff of its bytes says nothing
		binary = before.includes('\0') || after.includes('\0');
		reading = false;
	});
</script>

<Modal title={versions.title} icon={FileDiff} card="flex h-[85vh] w-[min(1100px,94vw)] max-w-none flex-col p-4" onClose={closeTwoVersions}>
	<div class="-mt-2 mb-3 flex items-center gap-2">
		<p class="text-muted min-w-0 truncate text-xs">{versions.subtitle}</p>
		<button
			class="btn-icon btn-icon-xs hover:preset-tonal ml-auto"
			onclick={() => (diffLayout = diffLayout === 'split' ? 'unified' : 'split')}
			use:tip={diffLayout === 'unified' ? m.wsview_switch_to_side_by_side() : m.wsview_switch_to_inline()}
			aria-label={diffLayout === 'unified' ? m.wsview_side_by_side_label() : m.wsview_inline_label()}
		>
			{#if diffLayout === 'split'}<Rows2 class="size-3.5" />{:else}<Columns2 class="size-3.5" />{/if}
		</button>
	</div>
	<div class="border-surface-200-800 min-h-0 flex-1 overflow-hidden rounded-base border">
		{#if reading}
			<p class="text-muted p-3 text-sm">{m.vcs_loading_changes()}</p>
		{:else if binary}
			<p class="text-muted p-3 text-sm">{m.vcs_version_changes_binary()}</p>
		{:else}
			<DiffPanel filename={versions.path} original={before} modified={after} layout={diffLayout} readOnly />
		{/if}
	</div>
</Modal>
