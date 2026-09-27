// Unsaved work in the way of a Sync or a branch switch becomes a version, then the operation runs
// again. What goes in is what the panel would tick by default.
import { it, expect, vi, beforeEach } from 'vitest';

const promptAsk = vi.fn(async () => 'save' as string | null);
const gitChanges = { current: [] as { path: string; x: string; y: string; files?: number }[] };
vi.mock('$lib/modals/confirm.svelte', () => ({ promptAsk }));
// the refresh brings in what the caller just wrote: here, the file that was not listed before
const refreshGitStatus = vi.fn(async () => {
	gitChanges.current = [...gitChanges.current, { path: '/p/flushed.tex', x: ' ', y: 'M' }];
});
vi.mock('$lib/workspace/gitStore', () => ({ gitChanges, refreshGitStatus }));
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/p' } }));

const { saveChangesFirst } = await import('$lib/workspace/scmSaveFirst');
const ASK = { title: 't', message: 'm', confirm: 'Save a version and sync', version: 'Unsaved work, saved before syncing' };

beforeEach(() => promptAsk.mockClear());

it('saves what changed, not new build output or a whole new folder, and hands busy back', async () => {
	gitChanges.current = [
		{ path: '/p/main.tex', x: ' ', y: 'M' },
		{ path: '/p/notes.md', x: '?', y: '?' },
		{ path: '/p/main.aux', x: '?', y: '?' },
		{ path: '/p/venv', x: '?', y: '?', files: 400 }
	];
	const busy: boolean[] = [];
	const commit = vi.fn(async () => true);
	expect(await saveChangesFirst({ commit, setBusy: (on) => busy.push(on) }, ASK)).toBe(true);
	// read again after the busy flag is let go, so the edit just flushed is in the version
	expect(refreshGitStatus).toHaveBeenCalledWith('/p');
	expect(commit).toHaveBeenCalledWith('Unsaved work, saved before syncing', ['/p/main.tex', '/p/notes.md', '/p/flushed.tex']);
	expect(busy).toEqual([false, true]);
});

it('does nothing when the author says no', async () => {
	promptAsk.mockResolvedValueOnce('cancel');
	const commit = vi.fn(async () => true);
	expect(await saveChangesFirst({ commit, setBusy: () => {} }, ASK)).toBe(false);
	expect(commit).not.toHaveBeenCalled();
});
