// Restore Contents as VS Code does it: asked first, the file replaced with the entry (in the
// file's own line endings), the open editor reloaded, and the restore kept as an entry of its own.
import { it, expect, vi, beforeEach } from 'vitest';

const promptAsk = vi.fn(async () => 'restore' as string | null);
const history = {
	readLocalHistory: vi.fn(async () => 'Old line.\nSecond.\n' as string | null),
	addLocalHistory: vi.fn(async () => null),
	removeLocalHistory: vi.fn(async () => true),
	renameLocalHistory: vi.fn(async () => true),
	removeAllLocalHistory: vi.fn(async () => {})
};
vi.mock('$lib/modals/confirm.svelte', () => ({ promptAsk }));
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$lib/workspace/localHistory.svelte', () => ({ ...history, sourceLabel: (s?: string) => s ?? 'File Saved', LOCAL_REF: 'local:' }));
const openFile = vi.fn();
vi.mock('$lib/workspace/workspaceStore', () => ({ openFile }));

const { LocalHistoryActions } = await import('$lib/workspace/localHistoryActions.svelte');

function make(loaded: string | null) {
	const deps = {
		getLoadedPath: () => loaded,
		flushPendingSave: vi.fn(async () => {}),
		whenSaved: vi.fn(async () => {}),
		readTextIfPresent: vi.fn(async () => 'Now.\r\n' as string | null),
		writeText: vi.fn(async () => {}),
		loadFile: vi.fn(async () => {}),
		openCompareTab: vi.fn()
	};
	return { actions: new LocalHistoryActions(deps), deps };
}
const ENTRY = { id: 'aB3d.tex', timestamp: 1_000 };

beforeEach(() => {
	promptAsk.mockClear();
	history.addLocalHistory.mockClear();
});

it('restores in the file’s own line endings, reloads it, and records the restore', async () => {
	const { actions, deps } = make('/p/main.tex');
	await actions.restore('/p/main.tex', ENTRY);
	expect(deps.flushPendingSave).toHaveBeenCalled();
	expect(deps.writeText).toHaveBeenCalledWith('/p/main.tex', 'Old line.\r\nSecond.\r\n');
	expect(deps.loadFile).toHaveBeenCalledWith('/p/main.tex');
	expect(history.addLocalHistory).toHaveBeenCalledWith('/p/main.tex', 'Old line.\nSecond.\n', 'restored');
});

it('changes nothing when the author says no', async () => {
	promptAsk.mockResolvedValueOnce('cancel');
	const { actions, deps } = make(null);
	await actions.restore('/p/main.tex', ENTRY);
	expect(deps.writeText).not.toHaveBeenCalled();
	expect(history.addLocalHistory).not.toHaveBeenCalled();
});

it('opens an entry against the file as a compare tab that reads from the history', () => {
	const { actions, deps } = make(null);
	actions.compare('/p/main.tex', ENTRY);
	expect(deps.openCompareTab).toHaveBeenCalledWith('/p/main.tex', expect.objectContaining({ hash: 'local:aB3d.tex' }));
});

it('brings back a deleted file as the copy was kept, and opens it', async () => {
	const { actions, deps } = make(null);
	deps.readTextIfPresent.mockResolvedValueOnce(null);
	await actions.restore('/p/chapters/methods.tex', ENTRY);
	expect(deps.writeText).toHaveBeenCalledWith('/p/chapters/methods.tex', 'Old line.\nSecond.\n');
	expect(openFile).toHaveBeenCalledWith('/p/chapters/methods.tex');
	expect(deps.loadFile).not.toHaveBeenCalled();
});
