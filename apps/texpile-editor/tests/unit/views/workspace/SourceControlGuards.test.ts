// @vitest-environment jsdom
// The panel's guarded states. During a merge: Finish combining stays disabled while any file still
// holds a marked place, the file row opens that file rather than a comparison, and the ordinary
// Save version box is not offered, since the merge is saved by Finish as one version. Inside a
// larger repository: nothing of it is used until the author says so.
import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SourceControlPanel from '../../../../src/lib/workspace/SourceControlPanel.svelte';
import type { GitStatusEntry } from '../../../../src/lib/workspace/git';

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function render(changes: GitStatusEntry[], extra: Record<string, unknown> = {}) {
	const calls = { finish: vi.fn(), cancel: vi.fn(), openConflict: vi.fn(), openDiff: vi.fn() };
	app = mount(SourceControlPanel, {
		target: document.body.appendChild(document.createElement('div')),
		props: {
			root: '/p',
			isRepo: true,
			branch: 'main',
			operation: 'merge',
			changes,
			history: [],
			onInit: () => {},
			onDiscard: () => {},
			onCommit: async () => true,
			onRestore: () => {},
			onCompare: () => {},
			onLoadChanges: async () => [],
			historyFraction: 0.4,
			onStartHistoryResize: () => {},
			onResizeHistoryByKey: () => {},
			onOpenDiff: calls.openDiff,
			onRefresh: () => {},
			onPublish: () => {},
			onSync: () => {},
			onIgnoreArtifacts: null,
			onOpenConflict: calls.openConflict,
			onFinishCombine: calls.finish,
			onCancelCombine: calls.cancel,
			...extra
		}
	});
	flushSync();
	return calls;
}

const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);

it('will not finish while a file still holds a marked place', () => {
	render([{ path: '/p/main.tex', x: 'U', y: 'U', markers: true }]);
	expect(button('Finish combining')?.disabled).toBe(true);
	expect(button('Cancel combining')?.disabled).toBe(false);
	expect(document.body.textContent).not.toContain('Ready');
	expect(document.querySelector('textarea')).toBeNull();
});

it('finishes once every place is chosen, and says the file is ready', () => {
	const calls = render([
		{ path: '/p/main.tex', x: 'U', y: 'U', markers: false },
		{ path: '/p/notes.tex', x: 'M', y: ' ' }
	]);
	expect(document.body.textContent).toContain('Every place is chosen');
	expect(document.body.textContent).toContain('Ready');
	button('Finish combining')!.click();
	expect(calls.finish).toHaveBeenCalledOnce();
});

it('opens a file both sides changed at its marked place, not as a comparison', () => {
	const calls = render([{ path: '/p/main.tex', x: 'U', y: 'U', markers: true }]);
	const row = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('main.tex'))!;
	row.click();
	expect(calls.openConflict).toHaveBeenCalledWith('/p/main.tex');
	expect(calls.openDiff).not.toHaveBeenCalled();
});

it('leaves a rebase to the terminal it was started in', () => {
	render([{ path: '/p/main.tex', x: 'U', y: 'U', markers: true }], { operation: 'rebase' });
	expect(button('Finish combining')).toBeUndefined();
	expect(document.body.textContent).toContain('git rebase --continue');
});

it('asks before using a repository that starts above the folder', () => {
	const onUse = vi.fn();
	const onInit = vi.fn();
	render([{ path: '/p/main.tex', x: 'M', y: ' ' }], {
		operation: null,
		root: '/home/ada/papers/thesis',
		parentRepo: '/home/ada',
		onUseParentRepo: onUse,
		onInit
	});
	// neither its changes nor anything that would save or send them
	expect(document.body.textContent).not.toContain('main.tex');
	expect(document.querySelector('textarea')).toBeNull();
	expect(document.body.textContent).toContain('/home/ada');
	button('Use that repository')!.click();
	expect(onUse).toHaveBeenCalledOnce();
	[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Start a repository for this folder'))!.click();
	expect(onInit).toHaveBeenCalledOnce();
});
