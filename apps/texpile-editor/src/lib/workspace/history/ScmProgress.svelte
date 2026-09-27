<script lang="ts">
	// VS Code's Source Control progress: an indeterminate line across the top of the view while a
	// repository operation runs (ProgressLocation.SourceControl), status reads excepted. Late, so an
	// operation that ends at once flashes nothing.
	import { m } from '$lib/paraglide/messages';

	let { active }: { active: boolean } = $props();
</script>

<div class="relative h-0.5 shrink-0 overflow-hidden">
	{#if active}
		<div class="reveal-late absolute inset-0" role="progressbar" aria-label={m.vcs_working()}>
			<div class="scm-progress-bit bg-primary-500 absolute inset-y-0 w-[5%]"></div>
		</div>
	{/if}
</div>

<style>
	/* monaco-progress-container's infinite bit: a short segment sweeping left to right */
	.scm-progress-bit {
		animation: scm-progress 4s linear infinite;
	}
	@keyframes scm-progress {
		from {
			transform: translateX(0) scaleX(1);
		}
		50% {
			transform: translateX(2500%) scaleX(3);
		}
		to {
			transform: translateX(4900%) scaleX(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.scm-progress-bit {
			animation: none;
			width: 100%;
			opacity: 0.5;
		}
	}
</style>
