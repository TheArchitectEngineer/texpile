// A change to a text as the list of edits that make it, and where a position in the text before
// them stands after. Replace across files uses these to carry what is pinned to a file that is
// not open (comments, suggestions) through the rewrite, the way an editor maps its decorations
// through each change.

/** text from `from` to `to` becomes `insert`; offsets are in the text before any of the edits */
export type TextEdit = { from: number; to: number; insert: string };

/** `text` with `edits` (in order, not overlapping) made */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
	let out = '';
	let at = 0;
	for (const e of edits) {
		out += text.slice(at, e.from) + e.insert;
		at = e.to;
	}
	return out + text.slice(at);
}

/** the edits that take the changed text back to `before` */
export function invertEdits(before: string, edits: readonly TextEdit[]): TextEdit[] {
	let shift = 0;
	return edits.map((e) => {
		const from = e.from + shift;
		shift += e.insert.length - (e.to - e.from);
		return { from, to: from + e.insert.length, insert: before.slice(e.from, e.to) };
	});
}

/** what each edit put in, as spans of the changed text */
export function insertedSpans(edits: readonly TextEdit[]): { from: number; to: number }[] {
	let shift = 0;
	return edits.map((e) => {
		const from = e.from + shift;
		shift += e.insert.length - (e.to - e.from);
		return { from, to: from + e.insert.length };
	});
}

/**
 * Where the start of a range stands after `edits`. Inside a replaced stretch it goes to the start
 * of what replaced it; text put in right at it goes before it.
 */
export function mapStart(pos: number, edits: readonly TextEdit[]): number {
	let shift = 0;
	for (const e of edits) {
		if (e.from > pos) break;
		if (e.from === e.to || pos >= e.to) shift += e.insert.length - (e.to - e.from);
		else return e.from + shift;
	}
	return pos + shift;
}

/**
 * Where the end of a range stands after `edits`. Inside a replaced stretch, or at its end, it goes
 * to the end of what replaced it; text put in right at it goes after it.
 */
export function mapEnd(pos: number, edits: readonly TextEdit[]): number {
	let shift = 0;
	for (const e of edits) {
		if (e.from >= pos) break;
		if (pos > e.to) shift += e.insert.length - (e.to - e.from);
		else return e.from + shift + e.insert.length;
	}
	return pos + shift;
}
