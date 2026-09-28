<script lang="ts">
	// The branch name in the panel's header, as the way to another branch: VS Code's status-bar
	// branch and its Checkout to... list in one. Local branches first, then the ones that exist only
	// on a remote, and what is typed in the filter becomes a new branch when nothing matches it. A
	// row's bin is VS Code's Delete Branch (or Delete Remote Branch).
	import { tip } from '$lib/components/tooltip.svelte';
	import { tick } from 'svelte';
	import { GitBranch, Check, Cloud, Plus, ChevronDown, LoaderCircle, Trash2 } from '@lucide/svelte';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { branchNameFrom, type GitBranchesResult, type GitRemoteBranch } from '$lib/workspace/gitBranches';
	import { gitHead } from '$lib/workspace/gitStore';
	import { MENU_ITEM, MENU_ICON, MENU_SPACER } from './rowMenu';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		branch: string | null;
		/** HEAD is on a version, not a branch: git calls the branch "HEAD" then, which says nothing */
		detached?: boolean;
		busy: boolean;
		list: () => Promise<GitBranchesResult>;
		/** each resolves to why it did not happen, or null once switched */
		onSwitch: (name: string) => Promise<string | null>;
		onCreate: (name: string) => Promise<string | null>;
		onTrack: (remoteName: string) => Promise<string | null>;
		/** VS Code's Delete Branch and Delete Remote Branch; absent where the app cannot */
		onDelete?: (name: string) => Promise<string | null>;
		onDeleteRemote?: (b: GitRemoteBranch) => Promise<string | null>;
	};
	let { branch, detached = false, busy, list, onSwitch, onCreate, onTrack, onDelete, onDeleteRemote }: Props = $props();

	// VS Code shows the commit; this says what it means and where the way back is
	const label = $derived(detached ? m.vcs_detached({ short: (gitHead.current ?? '').slice(0, 7) }) : (branch ?? m.vcs_no_branch()));
	const tipText = $derived(detached ? m.vcs_detached_tip() : `${label} · ${m.vcs_branch_switch_aria()}`);

	let open = $state(false);
	let loading = $state(false);
	let working = $state(false);
	let branches = $state<GitBranchesResult | null>(null);
	let filter = $state('');
	let error = $state<string | null>(null);
	let filterEl = $state<HTMLInputElement>();

	const wanted = $derived(filter.trim().toLowerCase());
	const local = $derived((branches?.local ?? []).filter((b) => b.name.toLowerCase().includes(wanted)));
	const remote = $derived((branches?.remote ?? []).filter((b) => b.name.toLowerCase().includes(wanted)));
	// a new branch is offered for a name nothing local already has, spelled the way git will take it
	const newName = $derived(branchNameFrom(filter));
	const offerNew = $derived(!!newName && !(branches?.local ?? []).some((b) => b.name === newName));

	async function show(next: boolean) {
		open = next;
		if (!next) return;
		error = null;
		filter = '';
		loading = true;
		branches = await list();
		loading = false;
		if (!branches.ok) error = branches.error ?? m.vcs_branch_failed();
		await tick();
		filterEl?.focus();
	}

	async function act(run: () => Promise<string | null>) {
		if (working) return;
		working = true;
		error = null;
		const problem = await run();
		working = false;
		if (problem === null) open = false;
		else if (problem) error = problem;
	}

	/** a delete keeps the list open, read again without that branch */
	async function remove(run: () => Promise<string | null>) {
		if (working) return;
		working = true;
		error = null;
		const problem = await run();
		if (problem === null) branches = await list();
		else if (problem) error = problem;
		working = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const name = filter.trim();
		const exact = (branches?.local ?? []).find((b) => b.name === name);
		if (exact) void act(() => onSwitch(exact.name));
		else if (local.length === 1 && !offerNew) void act(() => onSwitch(local[0].name));
		else if (offerNew) void act(() => onCreate(newName));
	}
</script>

{#snippet trash(label: string, run: () => void)}
	<button
		type="button"
		class="hover:preset-tonal hover:text-error-ink text-muted mr-1 shrink-0 rounded-base p-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
		onclick={run}
		disabled={working}
		use:tip={label}
		aria-label={label}
	>
		<Trash2 class="size-3.5" />
	</button>
{/snippet}

<Popover
	{open}
	onOpenChange={(e) => void show(e.open)}
	positioning={{ placement: 'bottom-start', offset: { mainAxis: 2 } }}
	autoFocus={false}
>
	<Popover.Trigger
		class="hover:preset-tonal flex min-w-0 items-center gap-1 rounded-base px-1 py-0.5 disabled:opacity-50"
		aria-label={m.vcs_branch_switch_aria()}
	>
		{#snippet element(attrs)}
			<!-- no tooltip while open: it would sit over the list it names -->
			<button {...attrs} use:tip={open ? undefined : tipText} disabled={busy}>
				<GitBranch class="size-3.5 shrink-0" />
				<span class="truncate font-medium {detached ? 'text-warning-ink' : ''}">{label}</span>
				<ChevronDown class="size-3 shrink-0 opacity-60" />
			</button>
		{/snippet}
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-floating-ui">
			<!-- the rows are the shared menu's items; the card is its own, as it opens with a filter -->
			<Popover.Content class="card bg-surface-50-950 border-surface-300-700 w-72 overflow-hidden border text-sm shadow-lg">
				<div class="border-surface-200-800 border-b p-2">
					<input
						class="input w-full text-sm"
						type="text"
						spellcheck="false"
						placeholder={m.vcs_branch_filter()}
						aria-label={m.vcs_branch_filter()}
						bind:this={filterEl}
						bind:value={filter}
						onkeydown={onKeydown}
						disabled={working}
					/>
				</div>
				<div class="max-h-72 overflow-y-auto py-1">
					{#if loading}
						<!-- a local read is usually done before it is worth announcing -->
						<p class="text-muted reveal-late flex items-center gap-2.5 px-3 py-1.5 text-sm">
							<LoaderCircle class="size-4 shrink-0 animate-spin" />{m.vcs_branch_loading()}
						</p>
					{:else}
						{#if offerNew}
							<button
								type="button"
								class={MENU_ITEM}
								onclick={() => act(() => onCreate(newName))}
								disabled={working}
								use:tip={m.vcs_branch_create_tip()}
							>
								<Plus class={MENU_ICON} />
								<span class="truncate">{m.vcs_branch_create({ name: newName })}</span>
							</button>
						{/if}
						{#each local as b (b.name)}
							<div class="group flex items-center">
								<!-- the whole name in the tip, as a remote row has its own: either can be cut short -->
								<button
									type="button"
									class="{MENU_ITEM} min-w-0 flex-1"
									onclick={() => (b.name === branch ? (open = false) : act(() => onSwitch(b.name)))}
									disabled={working}
									use:tip={b.upstream
										? `${m.vcs_branch_switch_tip({ name: b.name })} · ${b.upstream}`
										: m.vcs_branch_switch_tip({ name: b.name })}
								>
									{#if b.name === branch}<Check class={MENU_ICON} />{:else}<span class={MENU_SPACER}></span>{/if}
									<span class="truncate {b.name === branch ? 'font-medium' : ''}">{b.name}</span>
									<!-- capped, so a long upstream cannot squeeze out the name it belongs to -->
									{#if b.upstream}<span class="text-muted ml-auto max-w-[45%] min-w-0 truncate text-xs">{b.upstream}</span>{/if}
								</button>
								<!-- never the branch checked out, as in VS Code -->
								{#if onDelete && b.name !== branch}
									{@render trash(m.vcs_branch_delete(), () => remove(() => onDelete(b.name)))}
								{/if}
							</div>
						{/each}
						{#if remote.length}
							<div class="text-muted px-3 pt-2 pb-0.5 text-xs font-semibold tracking-wider uppercase">{m.vcs_branch_remote_group()}</div>
							{#each remote as b (b.name)}
								<div class="group flex items-center">
									<button
										type="button"
										class="{MENU_ITEM} min-w-0 flex-1"
										onclick={() => act(() => onTrack(b.name))}
										disabled={working}
										use:tip={m.vcs_branch_track_tip({ remote: b.remote })}
									>
										<Cloud class={MENU_ICON} />
										<span class="truncate">{b.branch}</span>
										<span class="text-muted ml-auto shrink-0 text-xs">{b.remote}</span>
									</button>
									{#if onDeleteRemote}
										{@render trash(m.vcs_branch_delete_remote_tip({ remote: b.remote }), () => remove(() => onDeleteRemote(b)))}
									{/if}
								</div>
							{/each}
						{/if}
						{#if !local.length && !remote.length && !offerNew}
							<p class="text-muted px-3 py-1 text-sm">{m.vcs_branch_none()}</p>
						{/if}
					{/if}
				</div>
				{#if working}
					<p class="text-muted border-surface-200-800 flex items-center gap-2 border-t px-3 py-1.5 text-xs">
						<LoaderCircle class="size-3.5 animate-spin" />{m.vcs_branch_switching()}
					</p>
				{/if}
				{#if error}
					<p class="text-error-ink border-surface-200-800 border-t px-3 py-1.5 text-xs whitespace-pre-line" role="alert">{error}</p>
				{/if}
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
