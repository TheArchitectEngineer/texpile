// Whether a file still holds a place git marked when both sides of a merge changed the same lines:
// a <<<<<<< line, then =======, then >>>>>>>, each at the start of a line. The editor has the full
// parser (apps/texpile-editor/src/lib/workspace/conflictMarkers.ts); this side only needs yes or no.

const OPEN = /^<{7}(?:[ \t]|\r?$)/;
const DIVIDER = /^={7}[ \t]*\r?$/;
const CLOSE = /^>{7}(?:[ \t]|\r?$)/;

export function hasConflictMarkers(text: string): boolean {
	if (!text.includes('<<<<<<<')) return false;
	let stage: 'none' | 'open' | 'divided' = 'none';
	for (const line of text.split('\n')) {
		if (OPEN.test(line)) stage = 'open';
		else if (stage === 'open' && DIVIDER.test(line)) stage = 'divided';
		else if (stage === 'divided' && CLOSE.test(line)) return true;
	}
	return false;
}
