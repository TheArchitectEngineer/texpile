// Publish to GitHub from a plain folder: a folder of many new files is one row in the panel, and it
// was left out of the first version even though the which-files question kept it.
import { it, expect, vi } from 'vitest';

const gitChanges = {
	current: [
		{ path: '/p/main.tex', x: '?', y: '?' },
		{ path: '/p/refs.bib', x: '?', y: '?' },
		{ path: '/p/figures', x: '?', y: '?', files: 250 } // electron gitStatusLimit.collapseUntracked
	] as { path: string; x: string; y: string; files?: number }[]
};
const askPublishFiles = vi.fn(async (ask: { entries: { name: string; folder: boolean }[] }) => ask.entries.map((e) => e.name)); // keeps everything ticked

vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/p' } }));
vi.mock('$lib/workspace/gitStore', () => ({ refreshGitStatus: vi.fn(async () => ({})), gitChanges }));
vi.mock('$lib/workspace/git', () => ({ gitInit: vi.fn(async () => ({ ok: true })) }));
vi.mock('$lib/workspace/gitDialogs.svelte', () => ({ askPublishFiles }));
vi.mock('$lib/workspace/gitFailureToast', () => ({ toastGitFailure: vi.fn() }));

const { ScmPublishNew } = await import('$lib/workspace/scmPublishNew');

it('a kept folder of new files goes into the first version', async () => {
	const scm = {
		busy: false,
		ignore: { exists: vi.fn(async () => false), artifacts: vi.fn(async () => {}), files: vi.fn(async () => {}) },
		commit: vi.fn(async (_m: string, _p: string[]) => true),
		publish: vi.fn(async () => {})
	};
	await new ScmPublishNew(scm as never).run();
	expect(scm.publish).toHaveBeenCalled();
	expect(scm.commit.mock.calls[0][1]).toContain('/p/figures');
});
