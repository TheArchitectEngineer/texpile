<script lang="ts">
	// VS Code's question before publishing a folder that has no .gitignore: which of its files and
	// folders go into the repository. Everything starts ticked; what is unticked is added to
	// .gitignore and stays on this computer, so a private draft or a data file is not uploaded.
	import { UploadCloud, Folder } from '@lucide/svelte';
	import Modal from '../Modal.svelte';
	import ModalActions from '../ModalActions.svelte';
	import FileIcon from '$lib/filetree/FileIcon.svelte';
	import { answerPublishFiles, type PublishFilesAsk } from '$lib/workspace/gitDialogs.svelte';
	import { m } from '$lib/paraglide/messages';

	let { ask }: { ask: PublishFilesAsk } = $props();

	// svelte-ignore state_referenced_locally
	let kept = $state<string[]>(ask.entries.map((e) => e.name));

	function toggle(name: string) {
		kept = kept.includes(name) ? kept.filter((n) => n !== name) : [...kept, name];
	}

	// VS Code's multi-select pick has one box over the list that ticks or clears every row
	const all = $derived(kept.length === ask.entries.length);
	const some = $derived(kept.length > 0 && !all);
	function toggleAll() {
		kept = all ? [] : ask.entries.map((e) => e.name);
	}

	function go() {
		if (kept.length) answerPublishFiles(kept);
	}

	/** the keyboard starts in the list, as the other Git dialogs start in their first field */
	function focusFirst(node: HTMLElement) {
		const t = setTimeout(() => node.querySelector<HTMLInputElement>('input')?.focus(), 0);
		return { destroy: () => clearTimeout(t) };
	}
</script>

<Modal title={m.vcs_publish_files_title()} icon={UploadCloud} onClose={() => answerPublishFiles(null)} onEnter={go}>
	<p class="text-muted mb-3 text-sm">{m.vcs_publish_files_desc()}</p>
	<!-- scrolls inside the dialog past about fourteen rows; each row is a top-level file or folder,
	     so a folder of thousands of files is still one row -->
	<ul class="border-surface-200-800 max-h-72 overflow-y-auto rounded-base border pb-1" use:focusFirst>
		{#if ask.entries.length > 1}
			<li class="bg-surface-50-950 border-surface-200-800 sticky top-0 z-10 border-b">
				<label class="hover:bg-surface-200-800 flex cursor-pointer items-center gap-2 px-2 py-1 text-sm">
					<input
						type="checkbox"
						class="checkbox border-surface-400-600 accent-primary-500 size-3.5 shrink-0"
						checked={all}
						indeterminate={some}
						onchange={toggleAll}
					/>
					<span class="text-muted">{m.vcs_select_all()}</span>
				</label>
			</li>
		{/if}
		{#each ask.entries as e, i (e.name)}
			<li class={i === 0 ? 'pt-1' : ''}>
				<label class="hover:bg-surface-200-800 flex cursor-pointer items-center gap-2 px-2 py-0.5 text-sm">
					<input
						type="checkbox"
						class="checkbox border-surface-400-600 accent-primary-500 size-3.5 shrink-0"
						checked={kept.includes(e.name)}
						onchange={() => toggle(e.name)}
					/>
					{#if e.folder}<Folder class="text-muted size-4 shrink-0" />{:else}<FileIcon name={e.name} class="size-4 shrink-0" />{/if}
					<span class="truncate">{e.name}{e.folder ? '/' : ''}</span>
				</label>
			</li>
		{/each}
	</ul>
	<ModalActions
		class="mt-5"
		size="xs"
		buttons={[
			{ label: m.vcs_cancel(), role: 'cancel', onclick: () => answerPublishFiles(null) },
			{ label: m.vcs_signin_continue(), role: 'primary', disabled: !kept.length, onclick: go }
		]}
	/>
</Modal>
