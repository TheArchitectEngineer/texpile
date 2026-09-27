// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import {
	cmConflicts,
	conflictBlocks,
	chooseConflict,
	chooseAllConflicts,
	nextConflict,
	previousConflict
} from '$lib/editor/source/cmConflicts';

const DOC = ['Intro.', '<<<<<<< HEAD', 'My line.', '=======', 'Their line.', '>>>>>>> origin/main', 'Outro.', ''].join('\n');

const views: EditorView[] = [];
afterEach(() => {
	for (const v of views.splice(0)) v.destroy();
});

function mount(doc = DOC): EditorView {
	const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [history(), cmConflicts()] }) });
	views.push(view);
	return view;
}

it('offers the three choices above each place, and names both sides', () => {
	const view = mount();
	const bars = view.dom.querySelectorAll('.cm-conflict-bar');
	expect(bars).toHaveLength(1);
	expect([...bars[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Keep mine', 'Keep theirs', 'Keep both']);
	expect(view.dom.querySelector('.cm-conflict-label-mine')?.textContent).toBe('Your version');
	expect(view.dom.querySelector('.cm-conflict-label-theirs')?.textContent).toBe('Their version · origin/main');
	expect(view.dom.querySelectorAll('.cm-conflict-mine')).toHaveLength(1);
	expect(view.dom.querySelectorAll('.cm-conflict-theirs')).toHaveLength(1);
});

it('replaces the whole place with the chosen side when a button is clicked', () => {
	const view = mount();
	const theirs = view.dom.querySelector<HTMLButtonElement>('.cm-conflict-choice-theirs')!;
	theirs.click();
	expect(view.state.doc.toString()).toBe('Intro.\nTheir line.\nOutro.\n');
	expect(view.state.field(conflictBlocks)).toEqual([]);
	expect(view.dom.querySelector('.cm-conflict-bar')).toBeNull();
});

it('makes each choice its own undo step, which brings the markers back', () => {
	const view = mount();
	view.dispatch({ changes: { from: 0, insert: 'Typed. ' }, userEvent: 'input.type' });
	const [block] = view.state.field(conflictBlocks);
	view.dispatch(chooseConflict(view.state, block, 'both'));
	expect(view.state.doc.toString()).toBe('Typed. Intro.\nMy line.\nTheir line.\nOutro.\n');

	undo(view);
	expect(view.state.doc.toString()).toBe(`Typed. ${DOC}`);
	expect(view.state.field(conflictBlocks)).toHaveLength(1);
});

it('follows a place that moved since its bar was drawn', () => {
	const view = mount();
	view.dispatch({ changes: { from: 0, insert: 'A new first paragraph.\n\n' } });
	view.dom.querySelector<HTMLButtonElement>('.cm-conflict-choice-mine')!.click();
	expect(view.state.doc.toString()).toBe('A new first paragraph.\n\nIntro.\nMy line.\nOutro.\n');
});

it('draws nothing in a file with no marked places', () => {
	const view = mount('Just text.\n=======\n');
	expect(view.state.field(conflictBlocks)).toEqual([]);
	expect(view.dom.querySelector('.cm-conflict-bar')).toBeNull();
});

const TWO = `${DOC}Middle.\n<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> origin/main\nEnd.\n`;

it('settles every place the same way at once, as one undo step', () => {
	const view = mount(TWO);
	view.dispatch(chooseAllConflicts(view.state, 'theirs')!);
	expect(view.state.doc.toString()).toBe('Intro.\nTheir line.\nOutro.\nMiddle.\nB\nEnd.\n');
	undo(view);
	expect(view.state.doc.toString()).toBe(TWO);
	expect(chooseAllConflicts(mount('No places.\n').state, 'mine')).toBeNull();
});

it('goes from one place to the next and back, wrapping round', () => {
	const view = mount(TWO);
	const [first, second] = view.state.field(conflictBlocks);
	nextConflict(view);
	expect(view.state.selection.main.head).toBe(first.from);
	nextConflict(view);
	expect(view.state.selection.main.head).toBe(second.from);
	nextConflict(view);
	expect(view.state.selection.main.head).toBe(first.from);
	previousConflict(view);
	expect(view.state.selection.main.head).toBe(second.from);
});

it('marks the words that differ between the two sides, and not the ones they share', () => {
	const view = mount('<<<<<<< HEAD\nThe engine weaves flowers and leaves.\n=======\nThe engine weaves flowers and lattices.\n>>>>>>> b\n');
	const mine = [...view.dom.querySelectorAll('.cm-conflict-differs-mine')].map((e) => e.textContent).join('');
	const theirs = [...view.dom.querySelectorAll('.cm-conflict-differs-theirs')].map((e) => e.textContent).join('');
	expect(mine).toContain('leaves');
	expect(theirs).toContain('lattices');
	expect(mine).not.toContain('engine');
	expect(theirs).not.toContain('flowers');
});
