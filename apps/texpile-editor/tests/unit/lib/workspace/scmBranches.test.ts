// A switch refused over unsaved work: the author is offered to save it as a version on this branch
// first, and the switch is tried again. Build output is left out, as Save version leaves it out.
import { it, expect, vi, beforeEach } from 'vitest';

const gitSwitch = vi.fn(async (_root: string, _name: string) => ({ ok: true, branch: 'draft' }) as object);
const promptAsk = vi.fn(async (_o: unknown) => 'save' as string | null);
const gitChanges = {
	current: [
		{ path: '/p/main.tex', x: ' ', y: 'M' },
		{ path: '/p/notes.tex', x: '?', y: '?' },
		{ path: '/p/main.aux', x: '?', y: '?' }
	]
};

type Del = { ok: boolean; failure?: string; remote?: string; error?: string };
const gitDeleteBranch = vi.fn(async (_root: string, _name: string, _force?: boolean): Promise<Del> => ({ ok: true }));
const gitDeleteRemoteBranch = vi.fn(async (_root: string, _name: string): Promise<Del> => ({ ok: true, remote: 'origin' }));
const confirmAsk = vi.fn(async (_msg: string, _o?: unknown) => true);

vi.mock('$lib/workspace/gitBranches', () => ({
	gitSwitch,
	gitBranches: vi.fn(),
	gitCreateBranch: vi.fn(),
	gitTrackBranch: vi.fn(),
	gitDeleteBranch,
	gitDeleteRemoteBranch
}));
vi.mock('$lib/workspace/gitStore', () => ({
	refreshGitStatus: vi.fn(),
	refreshGitHistory: vi.fn(),
	gitOperation: { current: null },
	gitChanges,
	gitBranch: { current: 'main' }
}));
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/p' } }));
vi.mock('$lib/modals/confirm.svelte', () => ({ promptAsk, confirmAsk }));
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster: { success: vi.fn(), error: vi.fn() } }));

const { ScmBranches } = await import('$lib/workspace/scmBranches.svelte');

function make() {
	const host = { busy: false, commit: vi.fn(async (_m: string, _p: string[]) => true) };
	const deps = {
		getLoadedPath: () => null,
		hasPendingSave: () => false,
		flushPendingSave: async () => {},
		refreshTree: async () => {},
		loadFile: async () => {},
		readTextIfPresent: async () => null,
		isDiffMode: () => false,
		captureDiffSnapshot: () => {}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- only what change() reads
	return { branches: new ScmBranches(host, deps as any), host };
}

beforeEach(() => vi.clearAllMocks());

it('offers to save the work first, then switches', async () => {
	gitSwitch.mockResolvedValueOnce({ ok: false, failure: 'dirty', files: ['/p/main.tex'] });
	const { branches, host } = make();
	expect(await branches.switchTo('draft')).toBeNull();
	expect((promptAsk.mock.calls[0][0] as { message: string }).message).toContain('main.tex');
	// everything the panel lists except build output, under a message that says why
	expect(host.commit).toHaveBeenCalledWith('Unfinished work, saved before switching to draft', ['/p/main.tex', '/p/notes.tex']);
	expect(gitSwitch).toHaveBeenCalledTimes(2);
	expect(host.busy).toBe(false);
});

it('switches nothing when the author declines, or the save fails', async () => {
	const { branches, host } = make();
	gitSwitch.mockResolvedValueOnce({ ok: false, failure: 'dirty', files: ['/p/main.tex'] });
	promptAsk.mockResolvedValueOnce('cancel');
	expect(await branches.switchTo('draft')).toBe('');
	expect(host.commit).not.toHaveBeenCalled();

	gitSwitch.mockResolvedValueOnce({ ok: false, failure: 'dirty', files: ['/p/main.tex'] });
	host.commit.mockResolvedValueOnce(false);
	expect(await branches.switchTo('draft')).toBe('');
	expect(gitSwitch).toHaveBeenCalledTimes(2);
});

it('deletes a branch at once when its versions are elsewhere too, and asks first when they are not', async () => {
	const { branches } = make();
	expect(await branches.remove('merged-draft')).toBeNull();
	expect(confirmAsk).not.toHaveBeenCalled();

	gitDeleteBranch.mockResolvedValueOnce({ ok: false, failure: 'unmerged' });
	expect(await branches.remove('camera-ready')).toBeNull();
	expect(confirmAsk.mock.calls[0][0]).toContain('camera-ready');
	expect(gitDeleteBranch).toHaveBeenLastCalledWith('/p', 'camera-ready', true);

	// backing out keeps it
	gitDeleteBranch.mockResolvedValueOnce({ ok: false, failure: 'unmerged' });
	confirmAsk.mockResolvedValueOnce(false);
	gitDeleteBranch.mockClear();
	expect(await branches.remove('camera-ready')).toBe('');
	expect(gitDeleteBranch).toHaveBeenCalledTimes(1);
});

it('asks before deleting a branch on the remote, and says why when the remote refuses', async () => {
	const { branches } = make();
	const b = { name: 'origin/old-draft', remote: 'origin', branch: 'old-draft', date: '' };
	confirmAsk.mockResolvedValueOnce(false);
	expect(await branches.removeRemote(b)).toBe('');
	expect(gitDeleteRemoteBranch).not.toHaveBeenCalled();

	expect(await branches.removeRemote(b)).toBeNull();
	expect(gitDeleteRemoteBranch).toHaveBeenCalledWith('/p', 'origin/old-draft');

	gitDeleteRemoteBranch.mockResolvedValueOnce({ ok: false, failure: 'network', remote: 'origin' });
	expect(await branches.removeRemote(b)).toMatch(/origin/);
});
