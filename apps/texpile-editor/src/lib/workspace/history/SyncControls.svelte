<script lang="ts">
	// Sync and Publish, in the two places the panel offers them: the small control beside the branch,
	// and the main button when nothing is waiting to be saved (VS Code's action button). While one of
	// them runs, the button says so rather than only greying out, which read as broken on a slow link.
	import { tip } from '$lib/components/tooltip.svelte';
	import { ArrowUp, ArrowDown, ArrowDownUp, CloudUpload, CloudDownload, LoaderCircle } from '@lucide/svelte';
	import { scmHandlers } from '$lib/workspace/scmHandlers.svelte';
	import { gitRunning } from '$lib/workspace/gitStore';
	import type { GitOperation } from '$lib/workspace/git';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		place: 'header' | 'action';
		tracking: string | null;
		ahead: number;
		behind: number;
		hasCommits: boolean;
		detached: boolean;
		branch: string | null;
		operation: GitOperation | null;
		busy: boolean;
		onSync: () => void;
		onPublish: () => void;
	};
	let { place, tracking, ahead, behind, hasCommits, detached, branch, operation, busy, onSync, onPublish }: Props = $props();

	// what Sync would do, naming versions and leaving out the side with nothing on it. `behind` is
	// only as fresh as the last fetch, and its phrase says so.
	const syncTip = $derived(
		[
			m.vcs_sync_tip({ tracking: tracking ?? '' }),
			...(behind > 0 ? [behind === 1 ? m.vcs_sync_to_receive_one() : m.vcs_sync_to_receive_count({ count: behind })] : []),
			...(ahead > 0 ? [ahead === 1 ? m.vcs_sync_to_send_one() : m.vcs_sync_to_send_count({ count: ahead })] : [])
		].join(' · ')
	);
	const publishable = $derived(!tracking && hasCommits && !detached && !!branch);
	// the header always has one or the other; the main button only when there is something to do
	const showSync = $derived(!!tracking && (place === 'header' || (!operation && (ahead > 0 || behind > 0))));
	const showPublish = $derived(publishable && (place === 'header' || !operation));
	const syncing = $derived(gitRunning.current === 'sync');
	const publishing = $derived(gitRunning.current === 'publish');
	const fetching = $derived(gitRunning.current === 'fetch');
	const HEADER = 'hover:preset-tonal flex items-center gap-1 rounded-base py-0.5 disabled:opacity-50';
	const ACTION = 'btn btn-xs preset-filled-primary-500 w-full gap-1.5';
</script>

{#snippet counts(size: string)}
	{#if behind > 0}<span class="flex items-center tabular-nums"><ArrowDown class={size} />{behind}</span>{/if}
	{#if ahead > 0}<span class="flex items-center tabular-nums"><ArrowUp class={size} />{ahead}</span>{/if}
{/snippet}

{#if showSync && place === 'header' && scmHandlers.current}
	<!-- looks without taking anything in: whether a co-author uploaded, before deciding to Sync -->
	<button
		class="btn-icon btn-icon-xs hover:preset-tonal"
		use:tip={fetching ? m.vcs_running_fetch() : m.vcs_fetch_tip({ remote: (tracking ?? '').split('/')[0] })}
		aria-label={m.vcs_fetch()}
		onclick={() => scmHandlers.current?.checkForNew()}
		disabled={busy}
	>
		{#if fetching}<LoaderCircle class="size-3.5 animate-spin" />{:else}<CloudDownload class="size-3.5" />{/if}
	</button>
{/if}
{#if showSync && place === 'header'}
	<!-- VS Code's two states. With an upstream: Sync, carrying what it would take in and send.
	     `ahead` is counted from local refs and is exact; `behind` is as of the last fetch, which Sync
	     itself runs, and the tooltip says so. Without one: Publish, once there is a version to
	     publish and a branch to publish it from. -->
	<button
		class="{HEADER} px-1"
		use:tip={syncing ? m.vcs_running_sync() : syncTip}
		aria-label={m.vcs_sync_aria()}
		onclick={onSync}
		disabled={busy || !!operation}
	>
		{#if syncing}
			<LoaderCircle class="size-3.5 animate-spin" />
		{:else}
			{@render counts('size-3.5')}
			{#if !behind && !ahead}<ArrowDownUp class="size-3.5" />{/if}
		{/if}
	</button>
{:else if showSync}
	<div class="px-2">
		<button class={ACTION} onclick={onSync} disabled={busy} use:tip={syncTip}>
			{#if syncing}
				<LoaderCircle class="size-3.5 animate-spin" />
				{m.vcs_running_sync()}
			{:else}
				<ArrowDownUp class="size-3.5" />
				{m.vcs_action_sync()}
				{@render counts('size-3')}
			{/if}
		</button>
	</div>
{:else if showPublish && place === 'header'}
	<button class="{HEADER} px-1.5" use:tip={m.vcs_publish_button_tip()} onclick={onPublish} disabled={busy}>
		{#if publishing}<LoaderCircle class="size-3.5 animate-spin" />{:else}<CloudUpload class="size-3.5" />{/if}
		<span>{publishing ? m.vcs_running_publish() : m.vcs_publish_button()}</span>
	</button>
{:else if showPublish}
	<div class="px-2">
		<button class={ACTION} onclick={onPublish} disabled={busy}>
			{#if publishing}<LoaderCircle class="size-3.5 animate-spin" />{:else}<CloudUpload class="size-3.5" />{/if}
			{publishing ? m.vcs_running_publish() : m.vcs_action_publish({ branch: branch ?? '' })}
		</button>
	</div>
{/if}
