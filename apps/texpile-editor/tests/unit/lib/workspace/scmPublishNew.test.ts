// Publish from a folder that is not a repository yet, as VS Code does it: with no
// .gitignore, ask which of the folder's files and folders go in, all ticked, and add what is
// unticked to .gitignore before the first version is saved.
import { it, expect, vi, beforeEach } from 'vitest';

const gitChanges = { current: [] as { path: string; x: string; y: string; files?: number }[] };
const askPublishFiles = vi.fn(async (_ask: { entries: { name: string; folder: boolean }[] }) => null as string[] | null);

vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/p' } }));
vi.mock('$lib/workspace/gitStore', () => ({ refreshGitStatus: vi.fn(async () => ({})), gitChanges }));
vi.mock('$lib/workspace/git', () => ({ gitInit: vi.fn(async () => ({ ok: true })) }));
vi.mock('$lib/workspace/gitDialogs.svelte', () => ({ askPublishFiles }));
vi.mock('$lib/workspace/gitFailureToast', () => ({ toastGitFailure: vi.fn() }));

const { ScmPublishNew } = await import('$lib/workspace/scmPublishNew');

function makeScm(hasIgnore: boolean) {
	return {
		busy: false,
		ignore: {
			exists: vi.fn(async () => hasIgnore),
			artifacts: vi.fn(async () => {}),
			files: vi.fn(async (_p: string[], _q?: boolean) => {})
		},
		commit: vi.fn(async (_msg: string, _paths: string[]) => true),
		publish: vi.fn(async () => {})
	};
}

beforeEach(() => {
	askPublishFiles.mockReset();
	gitChanges.current = [
		{ path: '/p/.gitignore', x: '?', y: '?' },
		{ path: '/p/main.tex', x: '?', y: '?' },
		{ path: '/p/notes-to-self.tex', x: '?', y: '?' },
		{ path: '/p/data/raw.csv', x: '?', y: '?' }
	];
});

it('asks which files go in, and ignores what was unticked before the first version', async () => {
	askPublishFiles.mockResolvedValueOnce(['data', 'main.tex']);
	const scm = makeScm(false);
	await new ScmPublishNew(scm as never).run();
	expect(askPublishFiles.mock.calls[0][0].entries).toEqual([
		{ name: 'data', folder: true },
		{ name: 'main.tex', folder: false },
		{ name: 'notes-to-self.tex', folder: false }
	]);
	expect(scm.ignore.files).toHaveBeenCalledWith(['/p/notes-to-self.tex'], true);
	expect(scm.commit).toHaveBeenCalled();
	expect(scm.publish).toHaveBeenCalled();
});

it('stops when the author backs out, and does not ask when a .gitignore was already there', async () => {
	const scm = makeScm(false);
	await new ScmPublishNew(scm as never).run();
	expect(scm.commit).not.toHaveBeenCalled();
	expect(scm.publish).not.toHaveBeenCalled();

	const kept = makeScm(true);
	await new ScmPublishNew(kept as never).run();
	expect(askPublishFiles).toHaveBeenCalledTimes(1);
	expect(kept.publish).toHaveBeenCalled();
});
