// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cmChangeMarkers, setChangeBaseline, changedLines, nextChange, previousChange } from '$lib/editor/source/cmChangeMarkers';

const LINES = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.', 'Eight.', 'Nine.', 'Ten.'];
const BASE = [...LINES, ''].join('\n');

const views: EditorView[] = [];
afterEach(() => {
	for (const v of views.splice(0)) v.destroy();
});

function mount(doc: string, base: string | null = BASE): EditorView {
	const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [cmChangeMarkers()] }) });
	views.push(view);
	view.dispatch({ effects: setChangeBaseline.of(base) });
	return view;
}

it('marks added, changed and removed lines against the last version', () => {
	// line 2 reworded, Five removed, a new line after Nine
	const now = ['One.', 'Two, reworded.', 'Three.', 'Four.', 'Six.', 'Seven.', 'Eight.', 'Nine.', 'Nine and a half.', 'Ten.', ''];
	const view = mount(now.join('\n'));
	expect(changedLines(view.state)).toEqual([
		{ kind: 'modified', from: 2, to: 2 },
		{ kind: 'removed', from: 5, to: 5 },
		{ kind: 'added', from: 9, to: 9 }
	]);
	expect(view.dom.querySelectorAll('.cm-change-modified')).toHaveLength(1);
	expect(view.dom.querySelectorAll('.cm-change-added')).toHaveLength(1);
	expect(view.dom.querySelectorAll('.cm-change-removed')).toHaveLength(1);
});

it('follows typing, and clears when the text matches the version again', () => {
	const view = mount(BASE);
	expect(changedLines(view.state)).toEqual([]);
	view.dispatch({ changes: { from: 0, insert: 'Zero.\n' } });
	expect(changedLines(view.state)).toEqual([{ kind: 'added', from: 1, to: 1 }]);
	view.dispatch({ changes: { from: 0, to: 'Zero.\n'.length } });
	expect(changedLines(view.state)).toEqual([]);
});

it('draws nothing without a saved version', () => {
	const view = mount('Anything.\n', null);
	expect(changedLines(view.state)).toEqual([]);
	expect(view.dom.querySelector('.cm-change-mark')).toBeNull();
});

it('goes to the next and previous change, wrapping round', () => {
	const view = mount(
		['One.', 'Two, reworded.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven, reworded.', 'Eight.', 'Nine.', 'Ten.', ''].join('\n')
	);
	const line = () => view.state.doc.lineAt(view.state.selection.main.head).number;
	expect(nextChange(view)).toBe(true);
	expect(line()).toBe(2);
	nextChange(view);
	expect(line()).toBe(7);
	nextChange(view);
	expect(line()).toBe(2);
	previousChange(view);
	expect(line()).toBe(7);
	expect(nextChange(mount(BASE))).toBe(false);
});
