<script lang="ts">
	// Draws the Source Control dialogs (gitDialogs.svelte.ts decides when). Mounted with the
	// workspace's other modals and on the start screen, which can clone; it listens for git's
	// questions while mounted, because they can come whenever an operation reaches a remote.
	import { githubStatus } from '$lib/workspace/githubSignIn.svelte';
	import GitIdentityModal from './GitIdentityModal.svelte';
	import GitPublishModal from './GitPublishModal.svelte';
	import GitQuestionModal from './GitQuestionModal.svelte';
	import GitCloneModal from './GitCloneModal.svelte';
	import { gitDialogs, listenForGitQuestions } from '$lib/workspace/gitDialogs.svelte';

	$effect(() => listenForGitQuestions());
	// whether GitHub's browser sign-in is offered, and who is signed in, for the palette
	$effect(() => void githubStatus.refresh());
</script>

{#if gitDialogs.identity}
	<GitIdentityModal initial={gitDialogs.identity} />
{/if}
{#if gitDialogs.publish}
	<GitPublishModal ask={gitDialogs.publish} />
{/if}
{#if gitDialogs.clone}
	<GitCloneModal ask={gitDialogs.clone} />
{/if}
<!-- keyed: each question starts with an empty field, never the answer to the one before it -->
{#if gitDialogs.question}
	{#key gitDialogs.question.id}
		<GitQuestionModal question={gitDialogs.question} />
	{/key}
{/if}
