<script lang="ts">
	// The branch name in the panel's header, as the way to another branch: VS Code's status-bar
	// branch and its Checkout to... list in one. Local branches first, then the ones that exist only
	// on a remote, and what is typed in the filter becomes a new branch when nothing matches it.
	import { tip } from '$lib/components/tooltip.svelte';
	import { tick } from 'svelte';
	import { GitBranch, Check, Cloud, Plus, ChevronDown, Loader2 } from '@lucide/svelte';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { branchNameFrom, type GitBranchesResult } from '$lib/workspace/gitBranches';
	import { gitHead } from '$lib/workspace/gitStore';
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
	};
	let { branch, detached = false, busy, list, onSwitch, onCreate, onTrack }: Props = $props();

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

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const name = filter.trim();
		const exact = (branches?.local ?? []).find((b) => b.name === name);
		if (exact) void act(() => onSwitch(exact.name));
		else if (local.length === 1 && !offerNew) void act(() => onSwitch(local[0].name));
		else if (offerNew) void act(() => onCreate(newName));
	}

	const ROW = 'hover:preset-tonal flex w-full items-center gap-2 px-3 py-1 text-left text-sm disabled:opacity-50';
</script>

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
			<Popover.Content class="card bg-surface-50-950 border-surface-300-700 w-72 border shadow-lg">
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
						<p class="text-muted flex items-center gap-2 px-3 py-1 text-sm">
							<Loader2 class="size-3.5 animate-spin" />{m.vcs_branch_loading()}
						</p>
					{:else}
						{#if offerNew}
							<button
								type="button"
								class={ROW}
								onclick={() => act(() => onCreate(newName))}
								disabled={working}
								use:tip={m.vcs_branch_create_tip()}
							>
								<Plus class="size-3.5 shrink-0" />
								<span class="truncate">{m.vcs_branch_create({ name: newName })}</span>
							</button>
						{/if}
						{#each local as b (b.name)}
							<button
								type="button"
								class={ROW}
								onclick={() => (b.name === branch ? (open = false) : act(() => onSwitch(b.name)))}
								disabled={working}
							>
								{#if b.name === branch}<Check class="size-3.5 shrink-0" />{:else}<span class="size-3.5 shrink-0"></span>{/if}
								<span class="truncate {b.name === branch ? 'font-medium' : ''}">{b.name}</span>
								{#if b.upstream}<span class="text-muted ml-auto shrink-0 truncate text-xs">{b.upstream}</span>{/if}
							</button>
						{/each}
						{#if remote.length}
							<div class="text-muted px-3 pt-2 pb-0.5 text-xs font-semibold tracking-wider uppercase">{m.vcs_branch_remote_group()}</div>
							{#each remote as b (b.name)}
								<button
									type="button"
									class={ROW}
									onclick={() => act(() => onTrack(b.name))}
									disabled={working}
									use:tip={m.vcs_branch_track_tip({ remote: b.remote })}
								>
									<Cloud class="size-3.5 shrink-0" />
									<span class="truncate">{b.branch}</span>
									<span class="text-muted ml-auto shrink-0 text-xs">{b.remote}</span>
								</button>
							{/each}
						{/if}
						{#if !local.length && !remote.length && !offerNew}
							<p class="text-muted px-3 py-1 text-sm">{m.vcs_branch_none()}</p>
						{/if}
					{/if}
				</div>
				{#if working}
					<p class="text-muted border-surface-200-800 flex items-center gap-2 border-t px-3 py-1.5 text-xs">
						<Loader2 class="size-3.5 animate-spin" />{m.vcs_branch_switching()}
					</p>
				{/if}
				{#if error}
					<p class="text-error-ink border-surface-200-800 border-t px-3 py-1.5 text-xs whitespace-pre-line" role="alert">{error}</p>
				{/if}
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
