<script lang="ts">
	// A repository found by looking upward, the way git does: used only once the author says so,
	// since saving a version here would record it in that repository with everything else in it.
	import { tip } from '$lib/components/tooltip.svelte';
	import { FolderTree, GitBranch } from '@lucide/svelte';
	import { m } from '$lib/paraglide/messages';

	let { repo, busy, onUse, onInit }: { repo: string; busy: boolean; onUse?: () => void; onInit: () => void } = $props();

	/** the end of a long path, which is the part that names the folder: the start is the same few
	 *  folders for every project on the machine */
	const shown = $derived.by(() => {
		const parts = repo.split(/[\\/]/).filter(Boolean);
		return repo.length > 32 && parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : repo;
	});
	const BUTTON = 'btn btn-xs preset-outlined-surface-200-800 hover:preset-tonal h-auto py-1 whitespace-normal';
</script>

<div class="flex flex-col items-center gap-3 p-6 text-center">
	<FolderTree class="text-faint size-8" />
	<p class="text-sm">{m.vcs_parent_repo()}</p>
	<p class="bg-surface-200-800 max-w-full truncate rounded-base px-2 py-0.5 font-mono text-xs" use:tip={repo}>{shown}</p>
	<p class="text-muted text-xs">{m.vcs_parent_repo_detail()}</p>
	<div class="flex w-full flex-col gap-1.5">
		<button class={BUTTON} onclick={onUse} disabled={busy}>{m.vcs_parent_repo_use()}</button>
		<button class="{BUTTON} gap-1.5" onclick={onInit} disabled={busy}>
			<GitBranch class="size-3.5" />
			{m.vcs_parent_repo_init()}
		</button>
	</div>
</div>
