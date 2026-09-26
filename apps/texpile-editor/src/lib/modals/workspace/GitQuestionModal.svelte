<script lang="ts">
	// A question git or ssh asked on the way to a remote - a username, a password or token, a key's
	// passphrase, or whether to trust a server it has not seen - asked here instead of in a terminal
	// nobody can see (electron/src/gitAskpass.ts). Git's own credential helpers are asked first, so
	// this appears only when they have nothing, and a helper that has one keeps it after it works.
	import { KeyRound, ShieldQuestionMark } from '@lucide/svelte';
	import Modal from '../Modal.svelte';
	import ModalActions from '../ModalActions.svelte';
	import { answerQuestion, type GitQuestion } from '$lib/workspace/gitDialogs.svelte';
	import { m } from '$lib/paraglide/messages';

	let { question }: { question: GitQuestion } = $props();

	let value = $state('');

	// GitHub has not taken account passwords for git since 2021; saying "password" there sends people
	// to type the one thing that cannot work
	const github = $derived(question.host === 'github.com' || !!question.host?.endsWith('.github.com'));

	const title = $derived.by(() => {
		if (question.subject === 'host-key')
			return question.host ? m.vcs_hostkey_title({ host: question.host }) : m.vcs_hostkey_title_generic();
		if (question.subject === 'passphrase') return m.vcs_passphrase_title();
		return question.host ? m.vcs_signin_title({ host: question.host }) : m.vcs_signin_title_generic();
	});

	const label = $derived.by(() => {
		if (question.subject === 'username') return m.vcs_signin_username();
		if (question.subject === 'passphrase') return m.vcs_passphrase();
		if (question.subject === 'password') return github ? m.vcs_signin_token() : m.vcs_signin_password();
		return question.prompt;
	});

	function submit() {
		if (question.input === 'confirm') answerQuestion(question.id, 'yes');
		// Enter reaches here past the disabled button; an empty answer is not one
		else if (value) answerQuestion(question.id, value);
	}
</script>

<!-- above every other dialog: it arrives while Publish is still up, and that one waits on this answer -->
<Modal
	{title}
	icon={question.input === 'confirm' ? ShieldQuestionMark : KeyRound}
	z="z-1400"
	card="max-h-full max-w-md overflow-y-auto p-5"
	onClose={() => answerQuestion(question.id, null)}
	onEnter={submit}
>
	{#if question.input === 'confirm'}
		<p class="text-muted mb-3 text-sm">{m.vcs_hostkey_desc()}</p>
		<pre class="bg-surface-100-900 rounded-base overflow-x-auto p-3 text-xs whitespace-pre-wrap">{question.prompt}</pre>
	{:else}
		{#if question.subject === 'password' && github}
			<p class="text-muted mb-3 text-sm">
				{m.vcs_signin_github_hint()}
				<a
					class="anchor"
					href="https://github.com/settings/tokens/new?scopes=repo&description=Texpile"
					target="_blank"
					rel="noopener noreferrer">{m.vcs_create_token()}</a
				>
			</p>
		{:else if question.subject !== 'other'}
			<!-- exactly what was asked, so it is plain which account or which key this is for -->
			<p class="text-muted mb-3 text-xs break-all">{question.prompt}</p>
		{/if}
		<label class="block text-sm">
			<span class="font-medium">{label}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="input mt-1 w-full text-sm"
				type={question.input === 'secret' ? 'password' : 'text'}
				autocomplete={question.subject === 'username' ? 'username' : 'off'}
				spellcheck="false"
				bind:value
				autofocus
			/>
		</label>
	{/if}
	<ModalActions
		class="mt-5"
		size="xs"
		buttons={[
			{ label: m.vcs_cancel(), role: 'cancel', onclick: () => answerQuestion(question.id, null) },
			{
				label: question.input === 'confirm' ? m.vcs_hostkey_trust() : m.vcs_signin_continue(),
				role: 'primary',
				disabled: question.input !== 'confirm' && !value,
				onclick: submit
			}
		]}
	/>
</Modal>
