<script lang="ts">
	// The folder is not a repository yet. Initialize is the git step; Publish is what most
	// people who open this panel came for, and used to take three: initialise, save a first version,
	// find Publish. It does those in order and ends in the same Publish dialog, which offers GitHub
	// and any other host: not everyone keeps their work on GitHub, so the button does not name it.
	import { FolderGit2, CloudUpload } from '@lucide/svelte';
	import { scmHandlers } from '$lib/workspace/scmHandlers.svelte';
	import { m } from '$lib/paraglide/messages';

	let { busy, onInit }: { busy: boolean; onInit: () => void } = $props();
</script>

<div class="flex flex-col items-center gap-3 p-6 text-center">
	<FolderGit2 class="text-faint size-8" />
	<p class="text-muted text-sm">{m.vcs_not_a_repo()}</p>
	<div class="flex w-full flex-col gap-1.5">
		<button class="btn btn-xs preset-filled-primary-500 gap-1.5" onclick={onInit} disabled={busy}>
			<FolderGit2 class="size-3.5" />
			{m.vcs_init_repo()}
		</button>
		{#if scmHandlers.current}
			<button
				class="btn btn-xs preset-outlined-surface-200-800 hover:preset-tonal gap-1.5"
				onclick={() => scmHandlers.current?.publishNew()}
				disabled={busy}
			>
				<CloudUpload class="size-3.5" />
				{m.vcs_publish_new()}
			</button>
			<p class="text-muted text-xs">{m.vcs_publish_new_detail()}</p>
		{/if}
	</div>
</div>
