// Switch branch, from the command palette. A switch refused over unsaved work: the author is offered
// to save it as a version on this branch first, and the switch is tried again. Build output is left
// out, as Save version leaves it out. The palette has closed by then, so the outcome is a notice.
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

const toastGitFailure = vi.fn();
const success = vi.fn();

vi.mock('$lib/workspace/gitBranches', () => ({ gitSwitch, gitBranches: vi.fn() }));
vi.mock('$lib/workspace/gitStore', () => ({
	refreshGitStatus: vi.fn(),
	refreshGitHistory: vi.fn(),
	gitOperation: { current: null },
	gitChanges,
	gitBranch: { current: 'main' }
}));
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/p' } }));
vi.mock('$lib/modals/confirm.svelte', () => ({ promptAsk }));
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster: { success, error: vi.fn() } }));
vi.mock('$lib/workspace/gitFailureToast', () => ({ toastGitFailure }));

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
	await branches.switchTo('draft');
	expect((promptAsk.mock.calls[0][0] as { message: string }).message).toContain('main.tex');
	// everything the panel lists except build output, under a message that says why
	expect(host.commit).toHaveBeenCalledWith('WIP before checkout to draft', ['/p/main.tex', '/p/notes.tex']);
	expect(gitSwitch).toHaveBeenCalledTimes(2);
	expect(host.busy).toBe(false);
	expect(success).toHaveBeenCalledWith({ title: 'Switched to branch "draft"' });
	expect(toastGitFailure).not.toHaveBeenCalled();
});

it('switches nothing when the author declines, or the save fails', async () => {
	const { branches, host } = make();
	gitSwitch.mockResolvedValueOnce({ ok: false, failure: 'dirty', files: ['/p/main.tex'] });
	promptAsk.mockResolvedValueOnce('cancel');
	await branches.switchTo('draft');
	expect(host.commit).not.toHaveBeenCalled();

	gitSwitch.mockResolvedValueOnce({ ok: false, failure: 'dirty', files: ['/p/main.tex'] });
	host.commit.mockResolvedValueOnce(false);
	await branches.switchTo('draft');
	expect(gitSwitch).toHaveBeenCalledTimes(2);
	// backing out is not a failure to report
	expect(toastGitFailure).not.toHaveBeenCalled();
	expect(success).not.toHaveBeenCalled();
});

it('says why a switch did not happen, in a notice', async () => {
	const { branches } = make();
	gitSwitch.mockResolvedValueOnce({ ok: false, failure: 'busy' });
	await branches.switchTo('draft');
	expect(toastGitFailure).toHaveBeenCalledWith(
		'Could not switch branches',
		'A merge, rebase, cherry-pick or revert is in progress. Continue or abort it first.',
		{}
	);
	expect(success).not.toHaveBeenCalled();
});
