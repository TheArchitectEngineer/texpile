// Whether a file still holds a place git marked when both sides of a merge changed the same lines.
// The editor has the full parser (apps/texpile-editor/src/lib/workspace/conflictMarkers.ts); this
// side only needs yes or no, and answers it the way VS Code does before it lets a file count as
// settled: any <<<<<<< or >>>>>>> line left at the start of a line, not only a whole
// <<<<<<< / ======= / >>>>>>> block. Deleting just the first line of a place used to read as
// choosing it, and the other two went into the version. A lone ======= is not counted (VS Code
// counts it): Markdown underlines a heading with one, and the file could never be finished.

const MARKER = /^(?:<{7}|>{7})(?:[ \t]|\r?$)/m;

export function hasConflictMarkers(text: string): boolean {
	return (text.includes('<<<<<<<') || text.includes('>>>>>>>')) && MARKER.test(text);
}
