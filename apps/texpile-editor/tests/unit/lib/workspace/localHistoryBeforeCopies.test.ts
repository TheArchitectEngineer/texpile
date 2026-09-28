// Local History keeps a copy before anything replaces text that no other copy holds: a discard in
// Source Control (whose notice then offers Undo), and Reload over unsaved edits when the file
// changed outside the app.
import { it, expect, vi, beforeEach } from 'vitest';

const addLocalHistory = vi.fn(async (_path: string, _content: string, _source?: string) => ({ id: 'aB3d.tex', timestamp: 1 }));
vi.mock('$lib/workspace/localHistory.svelte', () => ({ addLocalHistory }));
const success = vi.fn((_t: { title: string; action?: { label: string; onClick: () => void } }) => {});
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster: { success, error: vi.fn(), warning: vi.fn() } }));
vi.mock('$lib/modals/confirm.svelte', () => ({ confirmAsk: vi.fn(async () => true) }));
const gitDiscard = vi.fn(async (_root: string, _paths: string[]) => ({ ok: true }));
vi.mock('$lib/workspace/git', () => ({ gitDiscard, gitUnstage: vi.fn(async () => ({ ok: true })) }));
vi.mock('$lib/workspace/gitStore', () => ({
	isNewFile: (c: { x: string }) => c.x === '?' || c.x === 'A',
	refreshGitStatus: vi.fn(async () => {})
}));
vi.mock('$lib/workspace/workspaceStore', () => ({
	workspaceRoot: { current: '/p' },
	activeFilePath: { current: '/p/main.tex' },
	isDirty: { current: true }
}));
vi.mock('$lib/workspace/diskStamp', () => ({ recordDiskStamp: vi.fn(async () => {}) }));

const { ScmDiscard } = await import('$lib/workspace/scmDiscard.svelte');
const { ExternalChangeWatcher } = await import('$lib/workspace/externalChange.svelte');

beforeEach(() => {
	addLocalHistory.mockClear();
	success.mockClear();
});

it('keeps each discarded file in Local History, and Undo on the notice writes it back', async () => {
	const writeText = vi.fn(async (_p: string, _c: string) => {});
	const loadFile = vi.fn(async () => {});
	const discard = new ScmDiscard(
		{ busy: false },
		{
			getLoadedPath: () => '/p/main.tex',
			discardPendingSave: () => {},
			trashEntry: async () => 'trashed',
			removeEntry: async () => {},
			refreshTree: async () => {},
			loadFile,
			isDiffMode: () => false,
			captureDiffSnapshot: () => {},
			readTextIfPresent: async (p: string) => (p === '/p/main.tex' ? 'my unversioned paragraph' : null),
			writeText
		}
	);
	await discard.run([{ path: '/p/main.tex', x: ' ', y: 'M' }]);
	expect(addLocalHistory).toHaveBeenCalledWith('/p/main.tex', 'my unversioned paragraph', 'before-discard');
	expect(gitDiscard).toHaveBeenCalledWith('/p', ['/p/main.tex']);
	const notice = success.mock.calls[0][0];
	expect(notice.action?.label).toBe('Undo');
	notice.action!.onClick();
	await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('/p/main.tex', 'my unversioned paragraph'));
	await vi.waitFor(() => expect(loadFile).toHaveBeenCalledWith('/p/main.tex'));
});

it('keeps the unsaved edits before Reload replaces them with what changed on disk', async () => {
	const w = new ExternalChangeWatcher({
		getLoadedPath: () => '/p/main.tex',
		isTextual: () => true,
		isStructured: () => true,
		whenIdle: async () => {},
		readText: async () => 'theirs',
		getDiskBaseline: () => 'base',
		setDiskBaseline: () => {},
		getBuffer: () => 'mine, never saved',
		setTexSource: () => {},
		setRawContent: () => {},
		setEol: () => {},
		rebuildVisual: () => {},
		discardQueuedSave: () => {},
		sessionEdit: () => {},
		saveNow: () => {},
		exists: async () => true,
		setDeleted: () => {}
	});
	await w.check();
	w.resolve('reload');
	expect(addLocalHistory).toHaveBeenCalledWith('/p/main.tex', 'mine, never saved', 'before-reload');
});
