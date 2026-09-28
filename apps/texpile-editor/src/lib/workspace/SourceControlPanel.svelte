<script lang="ts">
	// History panel, purely presentational: WorkspaceView implements the callbacks. No
	// staged/unstaged split - the tick boxes ARE the staging, so a version's scope is visible.
	import { tip } from '$lib/components/tooltip.svelte';
	import { GitBranch, RefreshCw, Check, GitCommitHorizontal, PackageX, LoaderCircle } from '@lucide/svelte';
	import ChangeList from './history/ChangeList.svelte';
	import BranchPicker from './history/BranchPicker.svelte';
	import OperationBanner from './history/OperationBanner.svelte';
	import SyncControls from './history/SyncControls.svelte';
	import ScmProgress from './history/ScmProgress.svelte';
	import ParentRepoGate from './history/ParentRepoGate.svelte';
	import NoRepoGate from './history/NoRepoGate.svelte';
	import UnsafeRepoGate from './history/UnsafeRepoGate.svelte';
	import type { BranchActions } from '$lib/workspace/gitBranches';
	import HistoryTimeline from './history/HistoryTimeline.svelte';
	import { pathLabels } from './history/pathLabels';
	import { isBuildArtifact } from '$lib/workspace/buildArtifacts';
	// what is going on in git that only the display needs: not callbacks, so read here, not passed down
	import { isConflicted, gitRunning, gitUnsafe, gitTruncated } from '$lib/workspace/gitStore';
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
		/** the repository starts above this folder and the author has not said to use it */
		parentRepo?: string | null;
		onUseParentRepo?: () => void;
		/** switching and starting branches; absent where the app cannot, and the name is a label */
		branches?: BranchActions | null;
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
		/** name a version; absent where the app cannot */
		onMarkMilestone?: (entry: GitLogEntry, label: string) => Promise<string | null>;
		onRemoveMilestone?: (name: string, label: string) => void;
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
		parentRepo = null,
		onUseParentRepo,
		branches = null,
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
		onMarkMilestone,
		onRemoveMilestone,
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

	// one implementation of how a path is written, shared by the changes and a version's files
	const labels = $derived(pathLabels(root));

	// files both sides changed, which hold conflict markers until someone chooses: never ticked,
	// never part of an ordinary version
	const conflicts = $derived(changes.filter((c) => isConflicted(c.x, c.y)));
	// what the author wrote vs what the compiler wrote
	const artifacts = $derived(changes.filter((c) => !isConflicted(c.x, c.y) && isBuildArtifact(c.path)));
	const sources = $derived(changes.filter((c) => !isConflicted(c.x, c.y) && !isBuildArtifact(c.path)));

	// build output and whole folders of new files start unticked: ticking one is an opt-in
	function optIn(c: GitStatusEntry): boolean {
		return !!c.files || isBuildArtifact(c.path);
	}
	const selected = $derived(
		[...sources, ...artifacts]
			.filter((c) => (optIn(c) ? draft.artifactsOptedIn.includes(c.path) : !draft.excluded.includes(c.path)))
			.map((c) => c.path)
	);

	function toggle(path: string) {
		if (changes.some((c) => c.path === path && optIn(c))) {
			const on = draft.artifactsOptedIn;
			draft.artifactsOptedIn = on.includes(path) ? on.filter((p) => p !== path) : [...on, path];
			return;
		}
		const off = draft.excluded;
		draft.excluded = off.includes(path) ? off.filter((p) => p !== path) : [...off, path];
	}

	// a version saved in the middle of a merge would record it half-done, and one saved over a place
	// still marked for choosing would record the markers
	const canSave = $derived(!busy && !operation && !conflicts.some((c) => c.markers) && !!draft.message.trim() && selected.length > 0);

	async function save() {
		if (!canSave) return;
		if (await onCommit(draft.message, selected)) draft.clear();
	}

	/** a merge the panel can finish or cancel itself; the rest go back to the terminal they came from */
	const combining = $derived(operation === 'merge' && !!onFinishCombine && !!onCancelCombine);
	/** files still holding a place nobody has chosen for */
	const marked = $derived(conflicts.filter((c) => c.markers).length);

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
		<button class="btn btn-xs preset-outlined-surface-200-800 hover:preset-tonal w-full gap-1.5" onclick={onRecheckGit} disabled={busy}>
			<RefreshCw class="size-3.5" />
			{m.vcs_check_again()}
		</button>
	</div>
{:else if gitUnsafe.current && root}
	<UnsafeRepoGate {root} repo={gitUnsafe.current} />
{:else if !isRepo}
	<NoRepoGate {busy} {onInit} />
{:else if parentRepo}
	<ParentRepoGate repo={parentRepo} {busy} onUse={onUseParentRepo} {onInit} />
{:else}
	<div class="flex h-full min-h-0 flex-col">
		<ScmProgress active={busy || !!gitRunning.current} />
		<!-- refresh belongs beside the branch: both are the state of the repository, and parked above
		     an unrelated heading it read as a stray duplicate of the file tree's own refresh -->
		<div class="text-muted flex h-7 shrink-0 items-center gap-1.5 px-3 text-xs">
			{#if branches}
				<!-- the branch name is the way to another branch, as in VS Code's status bar -->
				<BranchPicker {branch} {detached} busy={busy || !!operation} {...branches} />
			{:else}
				<GitBranch class="size-3.5 shrink-0" />
				<span class="truncate font-medium">{branch ?? m.vcs_no_branch()}</span>
			{/if}
			<div class="ml-auto flex shrink-0 items-center gap-1">
				<SyncControls place="header" {tracking} {ahead} {behind} {hasCommits} {detached} {branch} {operation} {busy} {onSync} {onPublish} />
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
						<OperationBanner {operation} {marked} {busy} {onFinishCombine} {onCancelCombine} />
					{/if}
					{#if changes.length}
						<!-- The total, then the groups it is made of. Deliberately not a group row itself: no
						     tick box and no chevron, so a summary cannot be mistaken for what it summarises. -->
						<div class="border-surface-200-800 text-muted flex items-center gap-2 border-t px-3 py-1 text-xs">
							<span class="font-medium">{m.vcs_total_changes()}</span>
							<span class="tabular-nums">{gitTruncated.current || changes.length}</span>
						</div>
						{#if gitTruncated.current}
							<p class="text-warning-ink px-3 py-1 text-xs" role="status">
								{m.vcs_truncated({ shown: changes.length.toLocaleString(), count: gitTruncated.current.toLocaleString() })}
							</p>
						{/if}
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
						<!-- VS Code's action button: with nothing to save, what is left to do is send and receive
						     versions, or give the branch somewhere to go -->
						<SyncControls
							place="action"
							{tracking}
							{ahead}
							{behind}
							{hasCommits}
							{detached}
							{branch}
							{operation}
							{busy}
							{onSync}
							{onPublish}
						/>
					{/if}
				</div>

				<!-- outside the scroller: what you are about to save must not scroll away from its list. Not
				     while combining: the merge is saved by Finish combining, as one version -->
				{#if changes.length && !combining}
					<div class="border-surface-200-800 shrink-0 space-y-2 border-t px-2 py-2">
						<textarea
							data-scm-message
							class="textarea resize-none text-sm rounded-container"
							rows="2"
							placeholder={m.vcs_save_placeholder()}
							use:tip={m.vcs_commit_placeholder({ combo: combo('Enter') })}
							bind:value={draft.message}
							onkeydown={onKeydown}></textarea>
						<button
							class="btn btn-xs preset-filled-primary-500 w-full gap-1.5"
							onclick={save}
							disabled={!canSave}
							use:tip={m.vcs_save_version_tip()}
						>
							{#if gitRunning.current === 'save'}
								<LoaderCircle class="size-3.5 animate-spin" />
								{m.vcs_running_save()}
							{:else}
								<Check class="size-3.5" />
								{selected.length === 1 ? m.vcs_save_version_one() : m.vcs_save_version_count({ count: selected.length })}
							{/if}
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
				<!-- the explorer's section heading, so the two sidebars name their parts alike -->
				<div class="text-faint shrink-0 px-3 py-1 text-xs font-semibold tracking-wide uppercase">{m.vcs_history_heading()}</div>
				<div class="scroll-inset-r min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] pb-2">
					<HistoryTimeline
						{history}
						busy={busy || !!operation}
						branch={detached ? null : branch}
						error={historyError}
						hasMore={historyHasMore}
						onShowMore={onShowMoreHistory}
						{onLoadChanges}
						{onCompare}
						{onRestore}
						{onMarkMilestone}
						{onRemoveMilestone}
						baseName={labels.baseName}
						dirName={labels.dirName}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}
