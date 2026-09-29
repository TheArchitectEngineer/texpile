<script lang="ts">
	// What git is in the middle of when the panel cannot finish it itself - a rebase, cherry-pick or
	// revert, or a merge this app cannot complete - in words that say where to finish it: the
	// terminal it was started in. A merge the panel can finish shows as its buttons instead, where
	// Commit stands (MergeActions).
	import type { GitOperation } from '$lib/workspace/scm/git';
	import { m } from '$lib/paraglide/messages';

	let { operation }: { operation: GitOperation } = $props();

	const text = $derived(
		operation === 'merge'
			? m.vcs_op_merge()
			: operation === 'rebase'
				? m.vcs_op_rebase()
				: operation === 'cherry-pick'
					? m.vcs_op_cherry_pick()
					: m.vcs_op_revert()
	);
</script>

<!-- a line of warning text, no box, as the panel's note that the list was cut short -->
<p class="text-warning-ink px-3 py-1 text-xs" role="status">{text}</p>
