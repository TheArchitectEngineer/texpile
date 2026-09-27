// The source-mode table of contents: no ProseMirror plugin feeds the outline there, so parse
// headings from the raw .tex; \input fragments pre-scanned into projectIntel merge into one
// numbered project outline. A .typ's headings come from Typst's own parser instead. Debounced
// (display-only) and reading state LIVE at fire time, so typing never pays the parse. Visual
// mode's TOC comes from PM headings instead.
import { trailingDebounce } from '$lib/trailingDebounce';
import { sourceTocStore } from '$lib/editor/visual/extensions/tableofcontents/tocStore';
import { parseOutlineRaw, assembleProjectOutline } from '$lib/editor/visual/extensions/tableofcontents/latexHeadings';
import { typstSourceOutline } from '$lib/languages/typst/outline';
import { projectIntelStore } from '$lib/stores/projectIntel';
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import { dirname } from '$lib/workspace/fileSystem';
import type { WorkspaceDoc } from './workspaceDoc.svelte';

export function attachSourceToc(wsdoc: WorkspaceDoc): void {
	const { doc, modes } = wsdoc;
	// the Typst parse is async (the parser is a lazy import): only the latest one may publish
	let typstSeq = 0;
	const deferred = trailingDebounce<void>(300, () => {
		if (modes.mode !== 'source') return;
		if (doc.kind === 'typ') {
			const seq = ++typstSeq;
			void typstSourceOutline(doc.texSource).then((items) => {
				if (seq === typstSeq && doc.kind === 'typ' && modes.mode === 'source') sourceTocStore.current = items;
			});
			return;
		}
		if (doc.kind !== 'tex') return;
		sourceTocStore.current = assembleProjectOutline(
			parseOutlineRaw(doc.texSource),
			doc.path,
			doc.path ? dirname(doc.path) : null,
			workspaceRoot.current,
			projectIntelStore.current.outlines
		);
	});
	$effect(() => {
		void doc.texSource;
		void projectIntelStore.current;
		if ((doc.kind === 'tex' || doc.kind === 'typ') && modes.mode === 'source') deferred();
	});
	// a stale timer must not fire into the next workspace's store after unmount
	$effect(() => () => deferred.cancel());
}
