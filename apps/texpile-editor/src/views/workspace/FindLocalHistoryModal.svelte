<script lang="ts">
	// VS Code's Find Entry to Restore: every file in the project with Local History, a deleted one
	// included, and the copies each has. The Timeline shows only the file that is open, so this is
	// the one way back to a chapter that was deleted: pick it, pick a copy, Restore brings it back.
	import { onMount } from 'svelte';
	import { History, Columns2, Rows2, LoaderCircle } from '@lucide/svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import Modal from '$lib/modals/Modal.svelte';
	import FileIcon from '$lib/filetree/FileIcon.svelte';
	import { pathLabels } from '$lib/workspace/history/pathLabels';
	import {
		listAllLocalHistory,
		listLocalHistory,
		readLocalHistory,
		sourceLabel,
		type LocalHistoryEntry,
		type LocalHistoryFile
	} from '$lib/workspace/localHistory.svelte';
	import { localHistoryActions, entryDate } from '$lib/workspace/localHistoryActions.svelte';
	import { closeLocalHistoryFinder } from '$lib/workspace/localHistoryFinder.svelte';
	import { layout as savedLayout } from '$lib/storage/layout';
	import DiffPanel from './DiffPanel.svelte';
	import { m } from '$lib/paraglide/messages';

	let { root }: { root: string } = $props();

	const labels = $derived(pathLabels(root));
	let files = $state<LocalHistoryFile[]>([]);
	let loading = $state(true);
	let query = $state('');
	let file = $state<LocalHistoryFile | null>(null);
	let entries = $state<LocalHistoryEntry[]>([]);
	let entry = $state<LocalHistoryEntry | null>(null);
	let saved = $state('');
	let now = $state('');
	let diffLayout = $state<'unified' | 'split'>(savedLayout.current.diffLayout === 'split' ? 'split' : 'unified');
	let seq = 0;

	const shown = $derived(
		query.trim() ? files.filter((f) => labels.relPath(f.resource).toLowerCase().includes(query.trim().toLowerCase())) : files
	);

	onMount(async () => {
		files = await listAllLocalHistory(root);
		loading = false;
		if (files[0]) void pickFile(files[0]);
	});

	/** the search takes the keyboard as it appears, after the list is read, and a task later, as in
	 *  GitCloneModal: opened from a menu, the closing menu hands focus back to its trigger */
	function takeFocus(node: HTMLInputElement) {
		const t = setTimeout(() => node.focus(), 0);
		return { destroy: () => clearTimeout(t) };
	}

	async function pickFile(f: LocalHistoryFile) {
		file = f;
		const mine = ++seq;
		const listed = await listLocalHistory(f.resource); // newest first
		if (mine !== seq) return;
		entries = listed;
		if (listed[0]) await pickEntry(listed[0]);
		else entry = null;
	}

	/** the copy against the file as it is now, as VS Code opens it */
	async function pickEntry(e: LocalHistoryEntry) {
		if (!file) return;
		const f = file;
		const mine = ++seq;
		const [copy, current] = await Promise.all([
			readLocalHistory(f.resource, e.id),
			f.exists ? (localHistoryActions.current?.currentText(f.resource) ?? null) : null
		]);
		if (mine !== seq) return;
		// a deleted file: its copy against nothing, every line what Restore brings back
		saved = f.exists ? (copy ?? '') : '';
		now = f.exists ? (current ?? '') : (copy ?? '');
		// last: the comparison is drawn once per entry, from the text it has when it appears
		entry = e;
	}

	async function restore() {
		const actions = localHistoryActions.current;
		if (!file || !entry || !actions) return;
		const [f, e] = [file, entry];
		// closed first, as VS Code's picker is: the question Restore asks opens above the workspace,
		// and would sit behind this window
		closeLocalHistoryFinder();
		await actions.restore(f.resource, e);
	}

	function compare() {
		const actions = localHistoryActions.current;
		if (!file || !entry || !actions) return;
		actions.compare(file.resource, entry);
		closeLocalHistoryFinder();
	}
</script>

<Modal
	title={m.history_find_title()}
	icon={History}
	card="flex h-[85vh] w-[min(1100px,94vw)] max-w-none flex-col p-4"
	onClose={closeLocalHistoryFinder}
>
	{#if loading}
		<!-- nothing for the first 300ms, the app's threshold for announcing a wait -->
		<p class="text-muted reveal-late flex items-center gap-2 text-sm">
			<LoaderCircle class="size-4 shrink-0 animate-spin" />
			{m.vcs_loading_changes()}
		</p>
	{:else if !files.length}
		<p class="text-muted text-sm">{m.history_find_none()}</p>
	{:else}
		<div class="flex min-h-0 flex-1 gap-3">
			<div class="flex w-64 shrink-0 flex-col gap-2">
				<input
					class="input text-sm"
					type="search"
					placeholder={m.history_find_search()}
					aria-label={m.history_find_search()}
					bind:value={query}
					use:takeFocus
				/>
				<ul class="border-surface-200-800 min-h-0 flex-1 overflow-y-auto rounded-base border py-1">
					{#each shown as f (f.resource)}
						<li>
							<button
								class="hover:bg-surface-200-800 flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-sm {file === f
									? 'bg-surface-200-800'
									: ''}"
								onclick={() => pickFile(f)}
								use:tip={labels.relPath(f.resource)}
							>
								<FileIcon name={labels.baseName(f.resource)} class="size-4 shrink-0" />
								<span class="truncate {f.exists ? '' : 'text-muted line-through'}">{labels.baseName(f.resource)}</span>
								{#if labels.dirName(f.resource)}<span class="text-muted truncate text-xs">{labels.dirName(f.resource)}</span>{/if}
								{#if !f.exists}
									<span class="text-warning-ink ml-auto shrink-0 text-xs" use:tip={m.history_deleted_tip()}>{m.history_deleted()}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			</div>

			<div class="flex min-w-0 flex-1 flex-col gap-2">
				{#if !file}
					<p class="text-muted text-sm">{m.history_find_pick()}</p>
				{:else}
					<div class="flex items-center gap-2">
						<select
							class="select min-w-0 flex-1 text-sm"
							value={entry?.id ?? ''}
							onchange={(e) => {
								const picked = entries.find((x) => x.id === e.currentTarget.value);
								if (picked) void pickEntry(picked);
							}}
						>
							{#each entries as e (e.id)}
								<option value={e.id}>{sourceLabel(e.source)} · {entryDate(e.timestamp)}</option>
							{/each}
						</select>
						<button
							class="btn-icon btn-icon-xs hover:preset-tonal"
							onclick={() => (diffLayout = diffLayout === 'split' ? 'unified' : 'split')}
							use:tip={diffLayout === 'unified' ? m.wsview_switch_to_side_by_side() : m.wsview_switch_to_inline()}
							aria-label={diffLayout === 'unified' ? m.wsview_side_by_side_label() : m.wsview_inline_label()}
						>
							{#if diffLayout === 'split'}<Rows2 class="size-3.5" />{:else}<Columns2 class="size-3.5" />{/if}
						</button>
						{#if file.exists}
							<button class="btn btn-xs preset-outlined-surface-200-800 hover:preset-tonal" onclick={compare} disabled={!entry}
								>{m.history_compare_with_file()}</button
							>
						{/if}
						<button class="btn btn-xs preset-filled-primary-500" onclick={restore} disabled={!entry}>{m.history_restore()}</button>
					</div>
					<div class="border-surface-200-800 min-h-0 flex-1 overflow-hidden rounded-base border">
						{#if entry}
							{#key `${file.resource}:${entry.id}`}
								<DiffPanel filename={file.resource} original={saved} modified={now} layout={diffLayout} readOnly />
							{/key}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</Modal>
