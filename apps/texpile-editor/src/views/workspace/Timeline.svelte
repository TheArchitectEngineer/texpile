<script lang="ts">
	// VS Code's Timeline for the open file: its Local History (a copy per save, in the app's data)
	// and its git versions, newest first in one list. A row opens that copy or version against the
	// file as it is now; its menu restores, renames or deletes a local entry. For a project that has
	// never been put under git, the local half is the only history there is.
	import { tip } from '$lib/components/tooltip.svelte';
	import { History, GitCommitHorizontal, MoreHorizontal, Check } from '@lucide/svelte';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import TextPrompt from '$lib/chrome/menubar/TextPrompt.svelte';
	import SectionHeader from './SectionHeader.svelte';
	import { workspaceRoot } from '$lib/workspace/workspaceStore';
	import { isGitRepo, gitHead } from '$lib/workspace/gitStore';
	import { gitFileLog } from '$lib/workspace/gitVersion';
	import { showVersionChanges } from '$lib/workspace/versionChanges.svelte';
	import {
		canKeepLocalHistory,
		listLocalHistory,
		localHistoryRevision,
		sourceLabel,
		type LocalHistoryEntry
	} from '$lib/workspace/localHistory.svelte';
	import { localHistoryActions, entryDate } from '$lib/workspace/localHistoryActions.svelte';
	import type { GitLogEntry } from '$lib/workspace/git';
	import { m } from '$lib/paraglide/messages';

	let { path, collapsed, onToggle }: { path: string | null; collapsed: boolean; onToggle: () => void } = $props();

	type Item =
		{ kind: 'local'; key: string; at: number; entry: LocalHistoryEntry } | { kind: 'git'; key: string; at: number; entry: GitLogEntry };

	const SOURCES_KEY = 'texpile:timeline-sources';
	function readSources(): { local: boolean; git: boolean } {
		try {
			const saved = JSON.parse(localStorage.getItem(SOURCES_KEY) ?? 'null') as { local?: boolean; git?: boolean } | null;
			return { local: saved?.local !== false, git: saved?.git !== false };
		} catch {
			return { local: true, git: true };
		}
	}
	// VS Code's filter: which sources the list shows, remembered
	let sources = $state(readSources());
	function toggle(which: 'local' | 'git') {
		sources = { ...sources, [which]: !sources[which] };
		try {
			localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
		} catch {
			// kept for this session only
		}
	}

	let local = $state<LocalHistoryEntry[]>([]);
	let versions = $state<GitLogEntry[]>([]);
	let openMenu = $state<string | null>(null);
	let headerMenu = $state(false);
	let prompt: TextPrompt;

	// reread when the file changes, a save or restore adds an entry, or HEAD moves
	$effect(() => {
		const p = path;
		void localHistoryRevision.current;
		if (!p || !canKeepLocalHistory()) {
			local = [];
			return;
		}
		void listLocalHistory(p).then((entries) => {
			if (path === p) local = entries;
		});
	});
	$effect(() => {
		const p = path;
		const root = workspaceRoot.current;
		void gitHead.current;
		if (!p || !root || !isGitRepo.current) {
			versions = [];
			return;
		}
		void gitFileLog(root, p).then((res) => {
			if (path === p) versions = res.ok ? (res.entries ?? []) : [];
		});
	});

	const items = $derived(
		[
			...(sources.local ? local.map((entry): Item => ({ kind: 'local', key: `l:${entry.id}`, at: entry.timestamp, entry })) : []),
			...(sources.git
				? versions.map((entry): Item => ({ kind: 'git', key: `g:${entry.hash}`, at: Date.parse(entry.date) || 0, entry }))
				: [])
		].sort((a, b) => b.at - a.at)
	);

	/** VS Code's short timeline times: "now", "5 mins", "3 hrs", then the date */
	function ago(at: number): string {
		const mins = Math.round((Date.now() - at) / 60000);
		if (mins < 1) return m.vcs_ago_now();
		if (mins < 60) return m.vcs_ago_minutes({ count: mins });
		const hours = Math.round(mins / 60);
		if (hours < 24) return m.vcs_ago_hours({ count: hours });
		const days = Math.round(hours / 24);
		return days < 7 ? m.vcs_ago_days({ count: days }) : new Date(at).toLocaleDateString();
	}

	function open(item: Item) {
		const actions = localHistoryActions.current;
		if (!path || !actions) return;
		if (item.kind === 'local') actions.compare(path, item.entry);
		else actions.compareVersion(path, item.entry.hash, item.entry.subject);
	}

	async function run(fn: () => Promise<void> | void) {
		openMenu = null;
		headerMenu = false;
		await fn();
	}

	const SOURCE_ROWS: ['local' | 'git', () => string][] = [
		['local', () => m.timeline_local()],
		['git', () => m.timeline_git()]
	];
	const ROW = 'hover:preset-tonal flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm';
	const MENU = 'card bg-surface-50-950 border-surface-300-700 min-w-[200px] border py-1 shadow-lg';
</script>

{#snippet menu(open: boolean, onOpenChange: (open: boolean) => void, label: string, body: import('svelte').Snippet)}
	<Popover
		{open}
		onOpenChange={(e) => onOpenChange(e.open)}
		positioning={{ placement: 'bottom-end', offset: { mainAxis: 2 } }}
		autoFocus={false}
	>
		<Popover.Trigger
			class="hover:preset-tonal shrink-0 rounded-base p-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 {open
				? 'opacity-100'
				: ''}"
			aria-label={label}
		>
			{#snippet element(attrs)}
				<button {...attrs} use:tip={label}><MoreHorizontal class="size-3.5" /></button>
			{/snippet}
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-floating-ui">
				<Popover.Content class={MENU}>{@render body()}</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

{#snippet headerBody()}
	{#if path && canKeepLocalHistory()}
		<button
			type="button"
			class={ROW}
			onclick={() =>
				run(async () => {
					const name = await prompt.askText(m.history_create_title());
					if (name && path) await localHistoryActions.current?.create(path, name);
				})}>{m.history_create()}</button
		>
		<div class="border-surface-200-800 my-1 border-t"></div>
	{/if}
	{#each SOURCE_ROWS as [which, label] (which)}
		<button type="button" class={ROW} onclick={() => toggle(which)}>
			<Check class="size-4 shrink-0 {sources[which] ? '' : 'invisible'}" />
			{label()}
		</button>
	{/each}
	{#if canKeepLocalHistory()}
		<div class="border-surface-200-800 my-1 border-t"></div>
		<button type="button" class="{ROW} text-error-ink" onclick={() => run(() => localHistoryActions.current?.removeAll())}
			>{m.history_delete_all()}…</button
		>
	{/if}
{/snippet}
{#snippet headerActions()}
	{@render menu(headerMenu, (o) => (headerMenu = o), m.timeline_actions(), headerBody)}
{/snippet}

<div class="text-sm">
	<SectionHeader title={m.timeline_heading()} {collapsed} {onToggle} actions={headerActions} />
	{#if collapsed}
		<!-- nothing below a closed header -->
	{:else if !path}
		<p class="text-faint px-1 text-xs">{m.timeline_no_file()}</p>
	{:else if !items.length}
		<p class="text-faint px-1 text-xs">{m.timeline_empty()}</p>
	{:else}
		<div class="flex flex-col">
			{#each items as item (item.key)}
				{@const label = item.kind === 'local' ? sourceLabel(item.entry.source) : item.entry.subject}
				<div class="group hover:bg-surface-200-800 flex items-center gap-1.5 rounded-base px-1 py-0.5">
					<button
						class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
						onclick={() => open(item)}
						use:tip={item.kind === 'local'
							? `${entryDate(item.at)}\n${label}${item.entry.sourceDescription ? ` (${item.entry.sourceDescription})` : ''}`
							: `${item.entry.subject}\n${item.entry.author} · ${entryDate(item.at)}`}
					>
						{#if item.kind === 'local'}<History class="text-muted size-3.5 shrink-0" />{:else}<GitCommitHorizontal
								class="text-muted size-3.5 shrink-0"
							/>{/if}
						<span class="truncate">{label}</span>
						<span class="text-faint ml-auto shrink-0 text-xs tabular-nums">{ago(item.at)}</span>
					</button>
					{#snippet rowBody()}
						<button type="button" class={ROW} onclick={() => run(() => open(item))}>{m.history_compare_with_file()}</button>
						{#if item.kind === 'local' && path}
							{@const entry = item.entry}
							{@const p = path}
							<button type="button" class={ROW} onclick={() => run(() => localHistoryActions.current?.restore(p, entry))}
								>{m.history_restore()}…</button
							>
							<button
								type="button"
								class={ROW}
								onclick={() =>
									run(async () => {
										const name = await prompt.askText(m.history_rename_title(), entry.source ? sourceLabel(entry.source) : '');
										if (name) await localHistoryActions.current?.rename(p, entry, name);
									})}>{m.history_rename()}…</button
							>
							<div class="border-surface-200-800 my-1 border-t"></div>
							<button type="button" class="{ROW} text-error-ink" onclick={() => run(() => localHistoryActions.current?.remove(p, entry))}
								>{m.history_delete()}…</button
							>
						{:else if item.kind === 'git'}
							{@const entry = item.entry}
							<button type="button" class={ROW} onclick={() => run(() => showVersionChanges(entry))}>{m.vcs_version_changes_open()}</button>
							<button type="button" class={ROW} onclick={() => run(() => navigator.clipboard.writeText(entry.hash).catch(() => {}))}
								>{m.vcs_copy_id()}</button
							>
						{/if}
					{/snippet}
					{@render menu(openMenu === item.key, (o) => (openMenu = o ? item.key : null), m.vcs_row_actions(), rowBody)}
				</div>
			{/each}
		</div>
	{/if}
</div>
<TextPrompt bind:this={prompt} />
