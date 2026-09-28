<script lang="ts">
	// The folder is not a repository yet. One line says so in the panel's own word, version, and the
	// buttons carry the rest in their tooltips: two paragraphs of VS Code's welcome text, centred in
	// a narrow sidebar, outweighed the only two things here that do anything.
	// Publish is the filled one because it is what most people who open this panel came for, and
	// used to take three steps: initialise, save a first version, find Publish. It does those in
	// order and ends in the same Publish dialog, which offers GitHub and any other host: not
	// everyone keeps their work on GitHub, so the button does not name it.
	import { FolderGit2, CloudUpload } from '@lucide/svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import { scmHandlers } from '$lib/workspace/scmHandlers.svelte';
	import { m } from '$lib/paraglide/messages';

	let { busy, onInit }: { busy: boolean; onInit: () => void } = $props();

	const FILLED = 'preset-filled-primary-500';
	const OUTLINED = 'preset-outlined-surface-200-800 hover:preset-tonal';
</script>

<div class="flex flex-col items-center gap-3 p-6 text-center">
	<FolderGit2 class="text-faint size-8" />
	<p class="text-muted text-sm">{m.vcs_not_a_repo()}</p>
	<div class="flex w-full flex-col gap-1.5">
		<!-- the one filled button on the screen, whichever that is -->
		<button
			class="btn btn-xs gap-1.5 {scmHandlers.current ? OUTLINED : FILLED}"
			onclick={onInit}
			disabled={busy}
			use:tip={m.vcs_init_repo_tip()}
		>
			<FolderGit2 class="size-3.5" />
			{m.vcs_init_repo()}
		</button>
		{#if scmHandlers.current}
			<button
				class="btn btn-xs gap-1.5 {FILLED}"
				onclick={() => scmHandlers.current?.publishNew()}
				disabled={busy}
				use:tip={m.vcs_publish_new_tip()}
			>
				<CloudUpload class="size-3.5" />
				{m.vcs_publish_new()}
			</button>
		{/if}
	</div>
</div>
