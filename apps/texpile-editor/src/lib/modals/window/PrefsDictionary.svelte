<script lang="ts">
	// The words spell check takes as right, in the Spelling tab: added here, or from a misspelled
	// word's suggestion. The linter helpers keep Harper's in-memory dictionary in sync.
	import { X } from '@lucide/svelte';
	import { editorConfigStore } from '$lib/stores/editorStore';
	import { addWordToDocumentDictionary, removeWordFromDocumentDictionary } from '$lib/editor/spellcheck/harper';
	import { initSpellcheckConfig } from '$lib/editor/spellcheck/spellcheckConfig';
	import { m } from '$lib/paraglide/messages';

	// Preferences also opens from the start screen, before any editor has read the word list
	void initSpellcheckConfig();

	let newWord = $state('');
	const words = $derived([...(editorConfigStore.current?.dictionary ?? [])].sort((a, b) => a.localeCompare(b)));

	async function add() {
		const w = newWord.trim();
		if (!w) return;
		newWord = '';
		await addWordToDocumentDictionary(w);
	}
</script>

<div class="border-surface-200-800 border-b py-4 last:border-b-0">
	<div class="text-sm font-medium">{m.spelldict_heading()}</div>
	<p class="text-muted mt-1 text-xs leading-relaxed">{m.prefs_dictionary_note()}</p>
	<div class="mt-3 flex gap-2">
		<input
			bind:value={newWord}
			class="input flex-1 text-sm"
			placeholder={m.spelldict_add_word_placeholder()}
			aria-label={m.spelldict_add_word_placeholder()}
			spellcheck="false"
			onkeydown={(e) => {
				if (e.key === 'Enter') void add();
			}}
		/>
		<button class="btn btn-sm preset-filled-primary-500 shrink-0" type="button" onclick={add} disabled={!newWord.trim()}
			>{m.spelldict_add_button()}</button
		>
	</div>
	<ul class="border-surface-200-800 mt-2 max-h-48 overflow-y-auto rounded-base border px-3 [scrollbar-gutter:stable]">
		{#each words as word (word)}
			<li class="border-surface-200-800 flex items-center justify-between border-b py-1 text-sm last:border-b-0">
				<span class="truncate">{word}</span>
				<button
					class="btn-icon btn-icon-xs hover:preset-tonal opacity-60 hover:opacity-100"
					type="button"
					aria-label={m.spelldict_remove_word_label({ word })}
					onclick={() => removeWordFromDocumentDictionary(word)}
				>
					<X class="size-4" />
				</button>
			</li>
		{:else}
			<li class="text-muted py-3 text-center text-sm">{m.spelldict_empty_state()}</li>
		{/each}
	</ul>
</div>
