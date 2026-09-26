<script lang="ts">
	// Draws the Source Control dialogs (gitDialogs.svelte.ts decides when). Mounted with the
	// workspace's other modals, since only a workspace runs git; it listens for git's questions for
	// as long as one is open, because they can come whenever an operation reaches a remote.
	import GitIdentityModal from './GitIdentityModal.svelte';
	import GitPublishModal from './GitPublishModal.svelte';
	import GitQuestionModal from './GitQuestionModal.svelte';
	import { gitDialogs, listenForGitQuestions } from '$lib/workspace/gitDialogs.svelte';

	$effect(() => listenForGitQuestions());
</script>

{#if gitDialogs.identity}
	<GitIdentityModal initial={gitDialogs.identity} />
{/if}
{#if gitDialogs.publish}
	<GitPublishModal ask={gitDialogs.publish} />
{/if}
<!-- keyed: each question starts with an empty field, never the answer to the one before it -->
{#if gitDialogs.question}
	{#key gitDialogs.question.id}
		<GitQuestionModal question={gitDialogs.question} />
	{/key}
{/if}
