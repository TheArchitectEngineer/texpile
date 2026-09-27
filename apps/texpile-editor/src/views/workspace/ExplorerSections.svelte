<script lang="ts">
	// The explorer's lower pane, as VS Code's: Outline (here Contents) and Timeline, each under a
	// header that folds it away, remembered between sessions. A guest has no Timeline: the files and
	// their history are on the host's computer.
	import TableOfContents from './TableOfContents.svelte';
	import Timeline from './Timeline.svelte';
	import SectionHeader from './SectionHeader.svelte';
	import { activeFilePath } from '$lib/workspace/workspaceStore';
	import { m } from '$lib/paraglide/messages';

	type Props = { mode: 'visual' | 'source'; guest: boolean; onOpenFile?: (file: string, line: number) => void };
	let { mode, guest, onOpenFile }: Props = $props();

	const KEY = 'texpile:explorer-sections';
	function read(): { contents: boolean; timeline: boolean } {
		try {
			const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { contents?: boolean; timeline?: boolean } | null;
			return { contents: !!saved?.contents, timeline: !!saved?.timeline };
		} catch {
			return { contents: false, timeline: false };
		}
	}
	// which are folded away
	let closed = $state(read());
	function toggle(which: 'contents' | 'timeline') {
		closed = { ...closed, [which]: !closed[which] };
		try {
			localStorage.setItem(KEY, JSON.stringify(closed));
		} catch {
			// remembered for this session only
		}
	}
</script>

<div class="flex flex-col gap-2">
	<div>
		<SectionHeader title={m.toc_heading()} collapsed={closed.contents} onToggle={() => toggle('contents')} />
		{#if !closed.contents}
			<div class="mt-1"><TableOfContents {mode} {onOpenFile} heading={false} /></div>
		{/if}
	</div>
	{#if !guest}
		<Timeline path={activeFilePath.current} collapsed={closed.timeline} onToggle={() => toggle('timeline')} />
	{/if}
</div>
