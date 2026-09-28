<script lang="ts">
	// VS Code's Timeline for the open file: its Local History (a copy per save, in the app's data)
	// and its git versions, newest first in one list. A row opens that copy or version against the
	// file as it is now; its menu restores, renames or deletes a local entry. For a project that has
	// never been put under git, the local half is the only history there is.
	import { tip } from '$lib/components/tooltip.svelte';
	import {
		History,
		GitCommitHorizontal,
		MoreHorizontal,
		Check,
		GitCompare,
		FileDiff,
		RotateCcw,
		Pencil,
		Trash2,
		Search,
		Plus,
		LoaderCircle
	} from '@lucide/svelte';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import TextPrompt from '$lib/chrome/menubar/TextPrompt.svelte';
	import SectionHeader from './SectionHeader.svelte';
	import { workspaceRoot } from '$lib/workspace/workspaceStore';
	import { isGitRepo, gitHead, gitHeldBack } from '$lib/workspace/gitStore';
	import { gitFileAt, gitFileLog } from '$lib/workspace/gitVersion';
	import { showTwoVersions } from '$lib/workspace/twoVersions.svelte';
	import { openLocalHistoryFinder } from '$lib/workspace/localHistoryFinder.svelte';
	import { basename } from '$lib/workspace/fileSystem';
	import { showVersionChanges } from '$lib/workspace/versionChanges.svelte';
	import {
		canKeepLocalHistory,
		listLocalHistory,
		localHistoryRevision,
		readLocalHistory,
		entryBefore,
		sourceLabel,
		type LocalHistoryEntry
	} from '$lib/workspace/localHistory.svelte';
	import { localHistoryActions, entryDate } from '$lib/workspace/localHistoryActions.svelte';
	import type { GitLogEntry } from '$lib/workspace/git';
	import {
		MENU_CARD,
		MENU_ITEM,
		MENU_DANGER,
		MENU_ICON,
		MENU_SPACER,
		MENU_SEPARATOR,
		MENU_TRIGGER,
		hoverAction
	} from '$lib/workspace/history/rowMenu';
	import { m } from '$lib/paraglide/messages';

	let { path, collapsed, onToggle }: { path: string | null; collapsed: boolean; onToggle: () => void } = $props();

	type Item =
		{ kind: 'local'; key: string; at: number; entry: LocalHistoryEntry } | { kind: 'git'; key: string; at: number; entry: GitLogEntry };

	const SOURCES_KEY = 'texpile:timeline-sources';
	function readSources(): { local: boolean; git: boolean } {
		try {
			const saved = JSON.parse(localStorage.getItem(SOURCES_KEY) ?? 'null') as { local?: boolean; git?: boolean } | null;
			return { local: saved?.local !== false, git: saved?.git === true };
		} catch {
			return { local: true, git: false };
		}
	}
	// VS Code's filter: which sources the list shows, remembered. Git versions start hidden: they are
	// listed in Source Control's History, and one list per kind of history is easier to read than
	// both interleaved. The menu brings them back.
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
	// the file each list was last read for. Until both have answered for the file now open, the
	// Timeline is loading rather than empty, and the rows it still holds are another file's: shown,
	// their menus would restore or delete against this one
	let localFor = $state<string | null>(null);
	let versionsFor = $state<string | null>(null);
	const loaded = $derived(!!path && localFor === path && versionsFor === path);
	// VS Code's paging: a page of git versions at a time, one more asked for to know there are more
	const PAGE = 50;
	let gitLimit = $state(PAGE);
	let moreGit = $state(false);
	let openMenu = $state<string | null>(null);
	let headerMenu = $state(false);
	let prompt: TextPrompt;

	// reread when the file changes, a save or restore adds an entry, or HEAD moves
	$effect(() => {
		const p = path;
		void localHistoryRevision.current;
		if (!p || !canKeepLocalHistory()) {
			local = [];
			localFor = p;
			return;
		}
		void listLocalHistory(p).then((entries) => {
			if (path !== p) return;
			local = entries;
			localFor = p;
		});
	});
	// another file starts from the first page again
	$effect(() => {
		void path;
		gitLimit = PAGE;
	});
	$effect(() => {
		const p = path;
		const root = workspaceRoot.current;
		const limit = gitLimit;
		void gitHead.current;
		if (!p || !root || !isGitRepo.current || gitHeldBack.current) {
			versions = [];
			moreGit = false;
			versionsFor = p;
			return;
		}
		void gitFileLog(root, p, limit + 1).then((res) => {
			if (path !== p) return;
			const all = res.ok ? (res.entries ?? []) : [];
			moreGit = all.length > limit;
			versions = all.slice(0, limit);
			versionsFor = p;
		});
	});

	const gitShown = $derived(sources.git && versionsFor === path);
	const gitItems = $derived(
		gitShown ? versions.map((entry): Item => ({ kind: 'git', key: `g:${entry.hash}`, at: Date.parse(entry.date) || 0, entry })) : []
	);
	// with more git versions still to load, the list stops at the oldest one loaded, as VS Code's
	// does: a local entry below it would read as coming right after it, with versions missing between
	const cutoff = $derived(gitShown && moreGit ? Math.min(...gitItems.map((i) => i.at)) : -Infinity);
	const items = $derived(
		[
			...(sources.local && localFor === path
				? local.map((entry): Item => ({ kind: 'local', key: `l:${entry.id}`, at: entry.timestamp, entry }))
				: []),
			...gitItems
		]
			.filter((i) => i.at >= cutoff)
			.sort((a, b) => b.at - a.at)
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

	/** VS Code's Compare with Previous: what this save or version changed, not how it differs from now */
	function previousOf(item: Item): (() => Promise<string | null>) | null {
		const p = path;
		const root = workspaceRoot.current;
		if (!p) return null;
		if (item.kind === 'local') {
			const prev = entryBefore(local, item.entry.id);
			return prev ? () => readLocalHistory(p, prev.id) : null;
		}
		if (!root) return null;
		// the version this one was made from (its first parent), as VS Code compares: the next row down
		// is only the next by date, which after combining two branches is often the other branch's.
		// The older row still gives the name the file had then, for a rename
		const prev = versions[versions.indexOf(item.entry) + 1];
		const where = prev?.path ?? item.entry.path ?? p;
		const ref = `${item.entry.hash}^`;
		return async () => {
			const res = await gitFileAt(root, where, ref);
			return res.ok ? (res.content ?? '') : null;
		};
	}

	function comparePrevious(item: Item) {
		const before = previousOf(item);
		const p = path;
		const root = workspaceRoot.current;
		if (!before || !p) return;
		if (item.kind === 'local') {
			const id = item.entry.id;
			showTwoVersions({
				title: sourceLabel(item.entry.source),
				subtitle: m.history_previous_subtitle({ name: basename(p), date: entryDate(item.at) }),
				path: p,
				before,
				after: () => readLocalHistory(p, id)
			});
			return;
		}
		const { hash, subject } = item.entry;
		const then = item.entry.path ?? p;
		showTwoVersions({
			title: subject,
			subtitle: m.vcs_previous_subtitle({ name: basename(p) }),
			path: p,
			before,
			after: async () => {
				const res = root ? await gitFileAt(root, then, hash) : null;
				return res?.ok ? (res.content ?? '') : null;
			}
		});
	}

	function open(item: Item) {
		const actions = localHistoryActions.current;
		if (!path || !actions) return;
		if (item.kind === 'local') actions.compare(path, item.entry);
		else actions.compareVersion(path, item.entry.hash, item.entry.subject, item.entry.path);
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
</script>

{#snippet menu(open: boolean, onOpenChange: (open: boolean) => void, label: string, body: import('svelte').Snippet)}
	<Popover
		{open}
		onOpenChange={(e) => onOpenChange(e.open)}
		positioning={{ placement: 'bottom-end', offset: { mainAxis: 2 } }}
		autoFocus={false}
	>
		<Popover.Trigger class="{MENU_TRIGGER} {hoverAction(open)}" aria-label={label}>
			{#snippet element(attrs)}
				<button {...attrs} use:tip={label}><MoreHorizontal class="size-3.5" /></button>
			{/snippet}
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-floating-ui">
				<Popover.Content class={MENU_CARD}>{@render body()}</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

{#snippet headerBody()}
	{#if canKeepLocalHistory()}
		<button type="button" class={MENU_ITEM} onclick={() => run(openLocalHistoryFinder)}>
			<Search class={MENU_ICON} />
			{m.history_find()}
		</button>
		{#if path}
			<button
				type="button"
				class={MENU_ITEM}
				onclick={() =>
					run(async () => {
						const name = await prompt.askText(m.history_create_title());
						if (name && path) await localHistoryActions.current?.create(path, name);
					})}
			>
				<Plus class={MENU_ICON} />
				{m.history_create()}
			</button>
		{/if}
		<div class={MENU_SEPARATOR}></div>
	{/if}
	<!-- the tick sits where the other items have their icon -->
	{#each SOURCE_ROWS as [which, label] (which)}
		<button type="button" class={MENU_ITEM} aria-pressed={sources[which]} onclick={() => toggle(which)}>
			{#if sources[which]}<Check class={MENU_ICON} />{:else}<span class={MENU_SPACER}></span>{/if}
			{label()}
		</button>
	{/each}
	{#if canKeepLocalHistory()}
		<div class={MENU_SEPARATOR}></div>
		<button type="button" class="{MENU_ITEM} {MENU_DANGER}" onclick={() => run(() => localHistoryActions.current?.removeAll())}>
			<Trash2 class="size-4 shrink-0" />
			{m.history_delete_all()}
		</button>
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
		<!-- a deleted file cannot be opened to see its Timeline: its copies are found from here -->
		{#if canKeepLocalHistory()}
			<button type="button" class="text-muted hover:text-surface-950-50 px-1 text-left text-xs" onclick={openLocalHistoryFinder}
				>{m.history_find()}</button
			>
		{/if}
	{:else if !items.length && !loaded}
		<!-- not "No history yet" before the reads have said so. Nothing for the first 300ms, the
		     app's threshold for announcing a wait: a quick read never flashes it -->
		<p class="text-muted reveal-late flex items-center gap-2 px-1 text-xs">
			<LoaderCircle class="size-4 shrink-0 animate-spin" />
			{m.vcs_loading_changes()}
		</p>
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
						<button type="button" class={MENU_ITEM} onclick={() => run(() => open(item))}>
							<GitCompare class={MENU_ICON} />
							{m.history_compare_with_file()}
						</button>
						{#if previousOf(item)}
							<button type="button" class={MENU_ITEM} onclick={() => run(() => comparePrevious(item))}>
								<FileDiff class={MENU_ICON} />
								{m.history_compare_previous()}
							</button>
						{/if}
						{#if item.kind === 'local' && path}
							{@const entry = item.entry}
							{@const p = path}
							<!-- no "…" on Restore or Delete: they only ask to be confirmed. Rename asks for a name -->
							<button type="button" class={MENU_ITEM} onclick={() => run(() => localHistoryActions.current?.restore(p, entry))}>
								<RotateCcw class={MENU_ICON} />
								{m.history_restore()}
							</button>
							<button
								type="button"
								class={MENU_ITEM}
								onclick={() =>
									run(async () => {
										const name = await prompt.askText(m.history_rename_title(), sourceLabel(entry.source));
										if (name) await localHistoryActions.current?.rename(p, entry, name);
									})}
							>
								<Pencil class={MENU_ICON} />
								{m.history_rename()}…
							</button>
							<div class={MENU_SEPARATOR}></div>
							<button
								type="button"
								class="{MENU_ITEM} {MENU_DANGER}"
								onclick={() => run(() => localHistoryActions.current?.remove(p, entry))}
							>
								<Trash2 class="size-4 shrink-0" />
								{m.history_delete()}
							</button>
						{:else if item.kind === 'git'}
							{@const entry = item.entry}
							<button
								type="button"
								class={MENU_ITEM}
								onclick={() => run(() => showVersionChanges(entry))}
								use:tip={m.vcs_version_changes_open_tip()}
							>
								<FileDiff class={MENU_ICON} />
								{m.vcs_version_changes_open()}
							</button>
						{/if}
					{/snippet}
					{@render menu(openMenu === item.key, (o) => (openMenu = o ? item.key : null), m.vcs_row_actions(), rowBody)}
				</div>
			{/each}
			{#if gitShown && moreGit}
				<button type="button" class="text-muted hover:text-surface-950-50 px-1 py-0.5 text-left text-xs" onclick={() => (gitLimit += PAGE)}
					>{m.timeline_load_more()}</button
				>
			{/if}
		</div>
	{/if}
</div>
<TextPrompt bind:this={prompt} />
