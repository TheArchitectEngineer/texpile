<script lang="ts">
	// A merge the panel can finish, as VS Code's action button shows one (its Continue): Complete
	// Merge where Commit stands, greyed out while a file still holds a marked place, and Abort Merge
	// under it. No banner: the files still to settle are the Merge Changes group above, and the
	// tooltips say what is left. Both are in the command palette as well.
	import { tip } from '$lib/components/tooltip.svelte';
	import { Check, Undo2 } from '@lucide/svelte';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		/** files both sides changed that still hold a marked place */
		marked: number;
		busy: boolean;
		onFinish: () => void;
		onCancel: () => void;
	};
	let { marked, busy, onFinish, onCancel }: Props = $props();

	// in a narrow sidebar a name wraps, and a word too long for the room ends in …
	const LABEL = 'cap-center min-w-0 overflow-x-clip text-ellipsis';
</script>

<div class="border-surface-200-800 shrink-0 space-y-1 border-t px-2 py-2">
	<!-- disabled, not refused after the click: a file with <<<<<<< lines in it must never be saved as
	     though it were the merged text. The span carries the tip a disabled button does not show -->
	<span class="block" use:tip={marked ? m.vcs_finish_combine_tip() : m.vcs_finish_combine_ready_tip()}>
		<button class="btn btn-xs preset-filled-primary-500 w-full gap-1.5 whitespace-normal" onclick={onFinish} disabled={busy || marked > 0}>
			<Check class="size-3.5 shrink-0" />
			<span class={LABEL}>{m.vcs_finish_combine()}</span>
		</button>
	</span>
	<!-- plain text, in the error colour: what it asks next throws away every choice made so far -->
	<button
		class="btn btn-xs text-error-ink hover:preset-tonal w-full gap-1.5 whitespace-normal"
		onclick={onCancel}
		disabled={busy}
		use:tip={m.vcs_cancel_combine_tip()}
	>
		<Undo2 class="size-3.5 shrink-0" />
		<span class={LABEL}>{m.vcs_cancel_combine()}</span>
	</button>
</div>
