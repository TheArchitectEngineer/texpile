// The custom dictionary's box searches the list and adds to it at once: what is typed or pasted
// there is read as words the way the dictionary keeps them, and the list narrows to the words that
// match.

/** the words in what was typed or pasted: split at spaces, commas and semicolons, lower-cased (as
 *  the dictionary keeps them), each once */
export function wordsIn(input: string): string[] {
	return [
		...new Set(
			input
				.split(/[\s,;]+/)
				.map((w) => w.trim().toLowerCase())
				.filter(Boolean)
		)
	];
}

/** the words matching `query`, alphabetical: those starting with it first, then those holding it */
export function matching(words: readonly string[], query: string): string[] {
	const sorted = [...words].sort((a, b) => a.localeCompare(b));
	const q = query.trim().toLowerCase();
	if (!q) return sorted;
	return [...sorted.filter((w) => w.startsWith(q)), ...sorted.filter((w) => !w.startsWith(q) && w.includes(q))];
}
