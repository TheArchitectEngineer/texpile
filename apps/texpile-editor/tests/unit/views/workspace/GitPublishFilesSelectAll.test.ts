// @vitest-environment jsdom
// The which-files question before publishing a plain folder has one box over the list, as VS Code's
// multi-select pick does: it clears every row, ticks them all again, and shows a partial tick
// while only some are.
import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const answerPublishFiles = vi.fn();
vi.mock('$lib/workspace/gitDialogs.svelte', () => ({ answerPublishFiles }));

const { default: GitPublishFilesModal } = await import('../../../../src/lib/modals/workspace/GitPublishFilesModal.svelte');

let app: Record<string, unknown> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	answerPublishFiles.mockClear();
});

function render(names: string[]) {
	app = mount(GitPublishFilesModal, {
		target: document.body.appendChild(document.createElement('div')),
		props: { ask: { entries: names.map((name) => ({ name, folder: !name.includes('.') })) } }
	});
	flushSync();
}

const boxes = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const continueButton = () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Continue'))!;

it('clears every row, then ticks them all again', () => {
	render(['data', 'main.tex', 'refs.bib']);
	const [all, ...rows] = boxes();
	expect(all.checked).toBe(true);
	expect(rows.every((r) => r.checked)).toBe(true);

	all.click();
	flushSync();
	expect(boxes().every((b) => !b.checked)).toBe(true);
	expect((continueButton() as HTMLButtonElement).disabled).toBe(true);

	boxes()[0].click();
	flushSync();
	expect(boxes().every((b) => b.checked)).toBe(true);
	continueButton().click();
	expect(answerPublishFiles).toHaveBeenCalledWith(['data', 'main.tex', 'refs.bib']);
});

it('shows a partial tick while only some rows are ticked', () => {
	render(['data', 'main.tex']);
	boxes()[1].click();
	flushSync();
	const all = boxes()[0];
	expect(all.checked).toBe(false);
	expect(all.indeterminate).toBe(true);
});

it('has no box over a list of one', () => {
	render(['main.tex']);
	expect(boxes()).toHaveLength(1);
});
