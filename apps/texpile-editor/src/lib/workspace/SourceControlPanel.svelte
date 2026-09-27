<script lang="ts">
	// History panel, purely presentational: WorkspaceView implements the callbacks. No
	// staged/unstaged split - the tick boxes ARE the staging, so a version's scope is visible.
	import { tip } from '$lib/components/tooltip.svelte';
	import {
		GitBranch,
		RefreshCw,
		Check,
		GitCommitHorizontal,
		ArrowUp,
		ArrowDown,
		ArrowDownUp,
		CloudUpload,
		TriangleAlert,
		PackageX
	} from '@lucide/svelte';
	import ChangeList from './history/ChangeList.svelte';
	import HistoryTimeline from './history/HistoryTimeline.svelte';
	import { pathLabels } from './history/pathLabels';
	import { isBuildArtifact } from '$lib/workspace/buildArtifacts';
	import { isConflicted } from '$lib/workspace/gitStore';
	import { scmDraftFor } from '$lib/workspace/scmDraft.svelte';
	import type { GitStatusEntry, GitLogEntry, GitFileChange, GitOperation } from '$lib/workspace/git';
	import { combo } from '$lib/chrome/shortcutText';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		root: string;
		isRepo: boolean;
		/** git is not installed at all, which "not a repository" would misdescribe */
		gitMissing?: boolean;
		onRecheckGit?: () => void;
		/** an unfinished merge, rebase, cherry-pick or revert */
		operation?: GitOperation | null;
		branch: string | null;
		/** the upstream this branch tracks; null means there is nowhere to upload to yet */
		tracking?: string | null;
		/** versions saved here that the upstream does not have */
		ahead?: number;
		/** versions the upstream has that this branch does not, as of the last fetch */
		behind?: number;
		/** at least one version exists: before the first there is nothing to publish */
		hasCommits?: boolean;
		/** HEAD is a commit, not a branch: nothing to publish or sync */
		detached?: boolean;
		changes: GitStatusEntry[];
		history: GitLogEntry[];
		/** could not be read at all, as against having nothing in it */
		historyError?: string | null;
		/** the history runs past what was fetched */
		historyHasMore?: boolean;
		onShowMoreHistory?: () => void;
		busy?: boolean;
		onInit: () => void;
		onDiscard: (changes: GitStatusEntry[]) => void;
		onCommit: (message: string, paths: string[]) => Promise<boolean>;
		onRestore: (entry: GitLogEntry) => void;
		onCompare: (entry: GitLogEntry, path: string) => void;
		/** what differs between a version and the working copy, read when that version is opened */
		onLoadChanges: (hash: string) => Promise<GitFileChange[]>;
		/** the timeline's share of the panel (0..1) */
		historyFraction: number;
		splitEl?: HTMLDivElement;
		onStartHistoryResize: (e: MouseEvent) => void;
		onResizeHistoryByKey: (e: KeyboardEvent) => void;
		onOpenDiff: (path: string) => void;
		onRefresh: () => void;
		onPublish: () => void;
		onSync: () => void;
		onIgnoreArtifacts: (() => void) | null;
		/** a file both sides changed, opened at its first marked place */
		onOpenConflict?: (path: string) => void;
		/** save the merge as a version; absent where the app cannot, and the terminal does it */
		onFinishCombine?: () => void;
		onCancelCombine?: () => void;
	};
	let {
		root,
		isRepo,
		gitMissing = false,
		onRecheckGit,
		operation = null,
		branch,
		tracking = null,
		ahead = 0,
		behind = 0,
		hasCommits = true,
		detached = false,
		changes,
		history,
		historyError = null,
		historyHasMore = false,
		onShowMoreHistory,
		busy = false,
		onInit,
		onDiscard,
		onCommit,
		onRestore,
		onCompare,
		onLoadChanges,
		historyFraction,
		splitEl = $bindable(),
		onStartHistoryResize,
		onResizeHistoryByKey,
		onOpenDiff,
		onRefresh,
		onPublish,
		onSync,
		onIgnoreArtifacts,
		onOpenConflict,
		onFinishCombine,
		onCancelCombine
	}: Props = $props();

	// what the author has chosen but not saved, kept outside the panel so it survives the panel
	const draft = $derived(scmDraftFor(root));

	// what Sync would do, naming versions and leaving out the side with nothing on it. `behind` is
	// only as fresh as the last fetch, and its phrase says so.
	const syncTip = $derived(
		[
			m.vcs_sync_tip({ tracking: tracking ?? '' }),
			...(behind > 0 ? [behind === 1 ? m.vcs_sync_to_receive_one() : m.vcs_sync_to_receive_count({ count: behind })] : []),
			...(ahead > 0 ? [ahead === 1 ? m.vcs_sync_to_send_one() : m.vcs_sync_to_send_count({ count: ahead })] : [])
		].join(' · ')
	);

	// one implementation of how a path is written, shared by the changes and a version's files
	const labels = $derived(pathLabels(root));

	// files both sides changed, which hold conflict markers until someone chooses: never ticked,
	// never part of an ordinary version
	const conflicts = $derived(changes.filter((c) => isConflicted(c.x, c.y)));
	// what the author wrote vs what the compiler wrote
	const artifacts = $derived(changes.filter((c) => !isConflicted(c.x, c.y) && isBuildArtifact(c.path)));
	const sources = $derived(changes.filter((c) => !isConflicted(c.x, c.y) && !isBuildArtifact(c.path)));

	const selected = $derived([
		...sources.filter((c) => !draft.excluded.includes(c.path)).map((c) => c.path),
		...artifacts.filter((c) => draft.artifactsOptedIn.includes(c.path)).map((c) => c.path)
	]);

	function toggle(path: string) {
		if (artifacts.some((a) => a.path === path)) {
			const on = draft.artifactsOptedIn;
			draft.artifactsOptedIn = on.includes(path) ? on.filter((p) => p !== path) : [...on, path];
			return;
		}
		const off = draft.excluded;
		draft.excluded = off.includes(path) ? off.filter((p) => p !== path) : [...off, path];
	}

	// a version saved in the middle of a merge would record it half-done
	const canSave = $derived(!busy && !operation && !!draft.message.trim() && selected.length > 0);

	async function save() {
		if (!canSave) return;
		if (await onCommit(draft.message, selected)) draft.clear();
	}

	/** a merge the panel can finish or cancel itself; the rest go back to the terminal they came from */
	const combining = $derived(operation === 'merge' && !!onFinishCombine && !!onCancelCombine);
	/** files still holding a place nobody has chosen for */
	const marked = $derived(conflicts.filter((c) => c.markers).length);

	// what is unfinished, in words that say where to finish it
	const operationText = $derived(
		combining
			? marked
				? marked === 1
					? m.vcs_combining_one()
					: m.vcs_combining_count({ count: marked })
				: m.vcs_combining_ready()
			: operation === 'merge'
				? m.vcs_op_merge()
				: operation === 'rebase'
					? m.vcs_op_rebase()
					: operation === 'cherry-pick'
						? m.vcs_op_cherry_pick()
						: operation === 'revert'
							? m.vcs_op_revert()
							: ''
	);
	function onKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault();
			void save();
		}
	}
</script>

{#if gitMissing}
	<!-- "not under source control" with an Initialize button that then fails is what this used to say -->
	<div class="flex flex-col items-center gap-3 p-6 text-center">
		<PackageX class="text-faint size-8" />
		<p class="text-muted text-sm">{m.vcs_git_missing()}</p>
		<a class="anchor text-sm" href="https://texpile.com/docs/installation/git" target="_blank" rel="noopener noreferrer"
			>{m.vcs_git_install()}</a
		>
		<button class="btn btn-xs preset-outlined-surface-200-800 hover:preset-tonal gap-1.5" onclick={onRecheckGit} disabled={busy}>
			<RefreshCw class="size-3.5" />
			{m.vcs_check_again()}
		</button>
	</div>
{:else if !isRepo}
	<div class="flex flex-col items-center gap-3 p-6 text-center">
		<GitBranch class="text-faint size-8" />
		<p class="text-muted text-sm">{m.vcs_not_a_repo()}</p>
		<button class="btn btn-xs preset-filled-primary-500 gap-1.5" onclick={onInit} disabled={busy}>
			<GitBranch class="size-4" />
			{m.vcs_init_repo()}
		</button>
	</div>
{:else}
	<div class="flex h-full min-h-0 flex-col">
		<!-- refresh belongs beside the branch: both are the state of the repository, and parked above
		     an unrelated heading it read as a stray duplicate of the file tree's own refresh -->
		<div class="text-muted flex h-7 shrink-0 items-center gap-1.5 px-3 text-xs">
			<GitBranch class="size-3.5 shrink-0" />
			<span class="truncate font-medium">{branch ?? m.vcs_no_branch()}</span>
			<div class="ml-auto flex shrink-0 items-center gap-1">
				<!-- VS Code's two states. With an upstream: Sync, carrying what it would take in and send.
				     `ahead` is counted from local refs and is exact; `behind` is as of the last fetch, which
				     Sync itself runs, and the tooltip says so. Without one: Publish, once there is a version
				     to publish and a branch to publish it from. -->
				{#if tracking}
					<button
						class="hover:preset-tonal flex items-center gap-1 rounded-base px-1 py-0.5 disabled:opacity-50"
						use:tip={syncTip}
						aria-label={m.vcs_sync_aria()}
						onclick={onSync}
						disabled={busy || !!operation}
					>
						{#if behind > 0}
							<span class="flex items-center tabular-nums"><ArrowDown class="size-3.5" />{behind}</span>
						{/if}
						{#if ahead > 0}
							<span class="flex items-center tabular-nums"><ArrowUp class="size-3.5" />{ahead}</span>
						{/if}
						{#if !behind && !ahead}
							<ArrowDownUp class="size-3.5" />
						{/if}
					</button>
				{:else if hasCommits && !detached && branch}
					<button
						class="hover:preset-tonal flex items-center gap-1 rounded-base px-1.5 py-0.5 disabled:opacity-50"
						use:tip={m.vcs_publish_button_tip()}
						onclick={onPublish}
						disabled={busy}
					>
						<CloudUpload class="size-3.5" />
						<span>{m.vcs_publish_button()}</span>
					</button>
				{/if}
				<button
					class="btn-icon btn-icon-xs hover:preset-tonal"
					use:tip={m.vcs_refresh_title()}
					aria-label={m.vcs_refresh_aria()}
					onclick={onRefresh}
				>
					<RefreshCw class="size-3.5" />
				</button>
			</div>
		</div>

		<!-- which half matters depends on what you are doing, so it is not the scrollbar's decision -->
		<div class="flex min-h-0 flex-1 flex-col" bind:this={splitEl}>
			<div class="flex min-h-0 flex-col" style="flex: {1 - historyFraction} 1 0%">
				<div class="scroll-inset-r min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] pb-2">
					{#if operation}
						<div
							class="border-warning-500/40 bg-warning-500/10 mx-2 mt-1 mb-2 flex gap-2 rounded-base border px-2.5 py-2 text-xs"
							role="status"
						>
							<TriangleAlert class="text-warning-ink mt-0.5 size-3.5 shrink-0" />
							<div class="min-w-0 flex-1 space-y-2">
								<p>{operationText}</p>
								{#if combining}
									<div class="flex flex-wrap gap-1.5">
										<!-- disabled, not refused after the click: a file with <<<<<<< lines in it
										     must never be saved as though it were the combined text -->
										<span use:tip={marked ? m.vcs_finish_combine_tip() : undefined}>
											<button class="btn btn-xs preset-filled-primary-500 gap-1" onclick={onFinishCombine} disabled={busy || marked > 0}>
												<Check class="size-3.5" />
												{m.vcs_finish_combine()}
											</button>
										</span>
										<button class="btn btn-xs preset-outlined-surface-200-800 hover:preset-tonal" onclick={onCancelCombine} disabled={busy}>
											{m.vcs_cancel_combine()}
										</button>
									</div>
								{/if}
							</div>
						</div>
					{/if}
					{#if changes.length}
						<!-- The total, then the groups it is made of. Deliberately not a group row itself: no
						     tick box and no chevron, so a summary cannot be mistaken for what it summarises. -->
						<div class="border-surface-200-800 text-muted flex items-center gap-2 border-t px-3 py-1 text-xs">
							<span class="font-medium">{m.vcs_total_changes()}</span>
							<span class="tabular-nums">{changes.length}</span>
						</div>
						<div class="px-1.5">
							<ChangeList
								{root}
								{conflicts}
								{sources}
								{artifacts}
								{selected}
								onToggle={toggle}
								{onOpenDiff}
								{onOpenConflict}
								{onDiscard}
								{onIgnoreArtifacts}
							/>
						</div>
					{:else}
						<div class="text-muted mt-6 mb-2 flex flex-col items-center gap-1 text-center text-sm">
							<GitCommitHorizontal class="size-6 opacity-60" />
							{m.vcs_no_changes()}
						</div>
					{/if}
				</div>

				<!-- outside the scroller: what you are about to save must not scroll away from its list. Not
				     while combining: the merge is saved by Finish combining, as one version -->
				{#if changes.length && !combining}
					<div class="border-surface-200-800 shrink-0 space-y-2 border-t px-2 py-2">
						<textarea
							class="textarea resize-none text-sm rounded-container"
							rows="2"
							placeholder={m.vcs_save_placeholder()}
							use:tip={m.vcs_commit_placeholder({ combo: combo('Enter') })}
							bind:value={draft.message}
							onkeydown={onKeydown}></textarea>
						<button class="btn btn-xs preset-filled-primary-500 w-full gap-1.5" onclick={save} disabled={!canSave}>
							<Check class="size-4" />
							{selected.length === 1 ? m.vcs_save_version_one() : m.vcs_save_version_count({ count: selected.length })}
						</button>
					</div>
				{/if}
			</div>

			<!-- arrow keys resize when focused: the WAI-ARIA window-splitter pattern (role=separator + tabindex) -->
			<!-- eslint-disable-next-line svelte/valid-compile -->
			<div
				class="hover:bg-primary-wash active:bg-primary-flood relative z-20 -my-[3px] h-1.5 shrink-0 cursor-row-resize bg-transparent transition-colors"
				onmousedown={onStartHistoryResize}
				onkeydown={onResizeHistoryByKey}
				role="separator"
				aria-orientation="horizontal"
				aria-label={m.vcs_resize_history_aria()}
				tabindex="0"
			></div>

			<div class="border-surface-200-800 flex min-h-0 flex-col border-t" style="flex: {historyFraction} 1 0%">
				<div class="text-muted shrink-0 px-2 py-1 text-sm">{m.vcs_history_heading()}</div>
				<div class="scroll-inset-r min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] pb-2">
					<HistoryTimeline
						{history}
						busy={busy || !!operation}
						{branch}
						error={historyError}
						hasMore={historyHasMore}
						onShowMore={onShowMoreHistory}
						{onLoadChanges}
						{onCompare}
						{onRestore}
						baseName={labels.baseName}
						dirName={labels.dirName}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}
