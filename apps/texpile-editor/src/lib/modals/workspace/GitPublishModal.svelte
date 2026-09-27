<script lang="ts">
	// Where a branch is published: VS Code's Publish Branch, which with no remote offers GitHub and
	// with several asks which one. Here both are one list, plus a remote by address for any other
	// host. The choice runs while the dialog is up, so a name that is taken on GitHub or an address
	// that is wrong is corrected in place instead of starting over.
	import { CloudUpload } from '@lucide/svelte';
	import { tip } from '$lib/components/tooltip.svelte';
	import Modal from '../Modal.svelte';
	import ModalActions from '../ModalActions.svelte';
	import { closePublish, type PublishAsk, type PublishChoice } from '$lib/workspace/gitDialogs.svelte';
	import { m } from '$lib/paraglide/messages';

	let { ask }: { ask: PublishAsk } = $props();

	// an existing remote is the likely answer when there is one; GitHub otherwise
	// svelte-ignore state_referenced_locally
	let picked = $state<string>(ask.remotes[0] ? `remote:${ask.remotes[0].name}` : 'github');
	// svelte-ignore state_referenced_locally
	let repoName = $state(ask.defaultName);
	let isPrivate = $state(true);
	// uploads over SSH with the author's key; the token is still what creates the repository
	let ssh = $state(false);
	let url = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	// GitHub's own rule, so what is shown is what the repository will be called
	const cleanName = $derived(repoName.trim().replace(/[^A-Za-z0-9_.-]+/g, '-'));

	const choice = $derived.by((): PublishChoice | null => {
		if (picked === 'github') return cleanName ? { kind: 'github', name: cleanName, isPrivate, ssh } : null;
		if (picked === 'url') return url.trim() ? { kind: 'url', url: url.trim() } : null;
		return { kind: 'remote', remote: picked.slice('remote:'.length) };
	});

	async function publish() {
		if (!choice || busy) return;
		busy = true;
		error = null;
		const problem = await ask.submit(choice);
		busy = false;
		// '' is the author closing the sign-in prompt: nothing went wrong, so nothing is said
		if (problem === null) closePublish(true);
		else error = problem || null;
	}

	// stretched to the name field beside it, so the two controls share top and bottom edges
	const SEGMENT = 'bg-surface-200-800 rounded-base inline-flex shrink-0 items-stretch gap-1 p-0.5';
	function seg(active: boolean) {
		return `rounded-base flex items-center px-2.5 text-xs ${active ? 'bg-surface-50-950 font-medium shadow-sm' : 'text-muted hover:text-surface-950-50'}`;
	}
	const ROW = 'hover:preset-tonal-surface flex items-start gap-2 px-3 py-2 text-sm';
</script>

<!-- not dismissable mid-publish: the upload runs on regardless, and closing would hide how it ended -->
<Modal
	title={m.vcs_publish_dialog_title({ branch: ask.branch })}
	icon={CloudUpload}
	card="max-h-full max-w-lg overflow-y-auto p-5"
	dismissable={!busy}
	onClose={() => closePublish(false)}
	onEnter={publish}
>
	<p class="text-muted mb-3 text-sm">{m.vcs_publish_intro()}</p>

	<div class="border-surface-300-700 divide-surface-200-800 divide-y overflow-hidden rounded-container border">
		<!-- a div, not a label: a label may hold only the one control it names, and this row holds three -->
		<div class="{ROW} {picked === 'github' ? 'preset-tonal-primary' : ''}">
			<input
				id="publish-to-github"
				type="radio"
				class="radio mt-0.5"
				name="publish-to"
				value="github"
				bind:group={picked}
				disabled={busy}
			/>
			<div class="min-w-0 flex-1">
				<label for="publish-to-github" class="block cursor-pointer font-medium">{m.vcs_publish_github()}</label>
				{#if picked === 'github'}
					<!-- the row's tint colours its text, and muted text is a share of that colour: set the
					     ordinary text colour again so the hint below stays readable -->
					<div class="text-surface-950-50 mt-2 flex flex-wrap items-stretch gap-2">
						<input
							class="input min-w-40 flex-1 text-sm"
							type="text"
							aria-label={m.vcs_publish_github_name()}
							placeholder={m.vcs_publish_github_name()}
							bind:value={repoName}
							disabled={busy}
						/>
						<div class={SEGMENT} role="radiogroup" aria-label={m.vcs_publish_visibility()}>
							<button
								type="button"
								role="radio"
								aria-checked={isPrivate}
								class={seg(isPrivate)}
								onclick={() => (isPrivate = true)}
								disabled={busy}
							>
								{m.vcs_publish_private()}
							</button>
							<button
								type="button"
								role="radio"
								aria-checked={!isPrivate}
								class={seg(!isPrivate)}
								onclick={() => (isPrivate = false)}
								disabled={busy}
							>
								{m.vcs_publish_public()}
							</button>
						</div>
					</div>
					<label class="text-surface-950-50 mt-2 flex items-center gap-2 text-xs" use:tip={m.vcs_publish_ssh_tip()}>
						<input type="checkbox" class="checkbox size-3.5" bind:checked={ssh} disabled={busy} />
						{m.vcs_publish_ssh()}
					</label>
					<p class="text-surface-950-50 mt-2 text-xs">
						<span class="text-muted">{m.vcs_publish_github_signin()}</span>
						<a
							class="anchor underline"
							href="https://github.com/settings/tokens/new?scopes=repo&description=Texpile"
							target="_blank"
							rel="noopener noreferrer">{m.vcs_create_token()}</a
						>
					</p>
				{/if}
			</div>
		</div>

		{#each ask.remotes as r (r.name)}
			<label class="{ROW} cursor-pointer {picked === `remote:${r.name}` ? 'preset-tonal-primary' : ''}">
				<input type="radio" class="radio mt-0.5" name="publish-to" value="remote:{r.name}" bind:group={picked} disabled={busy} />
				<div class="min-w-0 flex-1">
					<div class="font-medium">{r.name}</div>
					<div class="text-muted truncate text-xs">{r.url}</div>
				</div>
			</label>
		{/each}

		<div class="{ROW} {picked === 'url' ? 'preset-tonal-primary' : ''}">
			<input id="publish-to-url" type="radio" class="radio mt-0.5" name="publish-to" value="url" bind:group={picked} disabled={busy} />
			<div class="min-w-0 flex-1">
				<label for="publish-to-url" class="block cursor-pointer font-medium">{m.vcs_publish_url()}</label>
				{#if picked === 'url'}
					<input
						class="input mt-2 w-full text-sm"
						type="text"
						spellcheck="false"
						aria-label={m.vcs_publish_url()}
						placeholder={m.vcs_publish_url_placeholder()}
						bind:value={url}
						disabled={busy}
					/>
				{/if}
			</div>
		</div>
	</div>

	{#if error}
		<p class="text-error-ink mt-3 text-sm whitespace-pre-line" role="alert">{error}</p>
	{/if}

	<ModalActions
		class="mt-5"
		size="xs"
		buttons={[
			{ label: m.vcs_cancel(), role: 'cancel', disabled: busy, onclick: () => closePublish(false) },
			{ label: m.vcs_publish_confirm(), role: 'primary', busy, disabled: !choice, onclick: publish }
		]}
	/>
</Modal>
