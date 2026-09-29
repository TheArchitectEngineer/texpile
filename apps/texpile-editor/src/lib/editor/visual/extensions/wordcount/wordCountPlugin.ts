import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { documentCountStore } from '$lib/stores/countStore.svelte';
import { trailingDebounce } from '$lib/trailingDebounce';
import { countProse } from '$lib/workspace/wordCount/proseWords';

const wordCountKey = new PluginKey('wordCount');

/**
 * The prose of a stretch of raw source (inline_latex, raw_latex), as the detailed count reads it:
 * latexProse or typstProse. Without one, raw blocks are left out and raw inline text counts as it
 * reads (Markdown).
 */
export type RawProse = (raw: string) => string;

// never prose: maths, code, and a citation, reference or label, whose text is a key
const SKIPPED = new Set(['inline_math', 'block_math', 'code_block', 'citation', 'ref', 'typ_ref', 'label']);
const RAW = new Set(['raw_latex', 'inline_latex']);

/**
 * The text counted, from `from` to `to`: text nodes as they read, raw source through `prose`, set
 * apart by spaces as the markup around it sets it apart in the source.
 */
function extractText(doc: Node, from: number, to: number, prose?: RawProse): string {
	let text = '';

	doc.nodesBetween(from, to, (node, pos) => {
		if (SKIPPED.has(node.type.name)) return false;
		if (prose && RAW.has(node.type.name)) {
			const start = Math.max(0, from - pos - 1);
			const end = Math.min(node.content.size, to - pos - 1);
			if (start < end) text += ` ${prose(node.textBetween(start, end))} `;
			return false;
		}
		if (!prose && node.type.name === 'raw_latex') return false;

		if (node.type.name === 'text' && node.text) {
			const start = Math.max(0, from - pos);
			const end = Math.min(node.text.length, to - pos);
			if (start < end) text += node.text.slice(start, end);
		}

		// space between blocks so words don't merge
		if (node.isBlock && text && !text.endsWith(' ')) text += ' ';

		return true;
	});

	return text.trim();
}

function updateSelectionCount(doc: Node, from: number, to: number, prose?: RawProse): void {
	if (from === to) {
		documentCountStore.selectionWords = null;
		documentCountStore.selectionCharacters = null;
		documentCountStore.selectionCharactersWithSpaces = null;
	} else {
		const { words, characters, charactersWithSpaces } = countProse(extractText(doc, from, to, prose));
		documentCountStore.selectionWords = words;
		documentCountStore.selectionCharacters = characters;
		documentCountStore.selectionCharactersWithSpaces = charactersWithSpaces;
	}
}

function updateDocCount(doc: Node): void {
	const { words, characters, charactersWithSpaces } = countProse(extractText(doc, 0, doc.content.size));
	documentCountStore.words = words;
	documentCountStore.characters = characters;
	documentCountStore.charactersWithSpaces = charactersWithSpaces;
}

/**
 * Tracks document and selection word/character counts into documentCountStore, a word counted as
 * the detailed count counts one (proseWords.ts). Counts are display-only, so the full-doc/range
 * walks run debounced instead of per transaction. Given `prose` (LaTeX, Typst), the plugin counts
 * selections only: the whole file is counted from its source (countOpenFile), as the details
 * count it, because this document holds a \cref the editor shows as code, and a \ref's key, as
 * text.
 */
export function createWordCountPlugin(prose?: RawProse) {
	const deferredDocCount = trailingDebounce(300, updateDocCount);
	const deferredSelectionCount = trailingDebounce(150, ({ doc, from, to }: { doc: Node; from: number; to: number }) =>
		updateSelectionCount(doc, from, to, prose)
	);

	return new Plugin({
		key: wordCountKey,

		state: {
			init(_config, state) {
				if (!prose) updateDocCount(state.doc);
				const { from, to } = state.selection;
				updateSelectionCount(state.doc, from, to, prose);
				return null;
			},

			apply(tr) {
				if (tr.docChanged && !prose) deferredDocCount(tr.doc);
				// selection can change without a doc change; one debouncer for range counts AND the
				// collapsed clear, so a pending count can never land after a newer clear
				const { from, to } = tr.selection;
				deferredSelectionCount({ doc: tr.doc, from, to });
				return null;
			}
		},
		// a timer outliving this editor would overwrite the NEXT document's counts
		view: () => ({
			destroy: () => {
				deferredDocCount.cancel();
				deferredSelectionCount.cancel();
			}
		})
	});
}
