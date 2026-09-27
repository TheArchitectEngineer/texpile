// Switching, starting and taking up branches, against real repos (gitLiveFixture.ts).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	gitBranches,
	gitSwitch,
	gitCreateBranch,
	gitTrackBranch,
	gitDeleteBranch,
	gitDeleteRemoteBranch,
	parseRefs
} from '../../../../../../electron/src/gitBranches';
import { AVAILABLE, run, out, commit, removeTempDirs, makePublished } from './gitLiveFixture';

afterEach(removeTempDirs);

describe.skipIf(!AVAILABLE)('branches', () => {
	it('lists the local branches, and the remote ones nothing here tracks yet', async () => {
		const { root, other } = await makePublished();
		run(other, 'switch', '-q', '-c', 'appendix');
		commit(other, 'appendix.tex', 'Appendix.\n', 'Start the appendix');
		run(other, 'push', '-q', '-u', 'origin', 'appendix');
		run(root, 'fetch', '-q');
		run(root, 'branch', 'draft');

		const res = await gitBranches(root);
		const main = out(root, 'branch', '--show-current');
		expect(res.current).toBe(main);
		expect(res.local?.map((b) => b.name).sort()).toEqual(['draft', main].sort());
		expect(res.local?.find((b) => b.name === main)?.upstream).toBe(`origin/${main}`);
		// origin/<main> is what the local branch tracks, so only the appendix is on offer
		expect(res.remote).toEqual([expect.objectContaining({ name: 'origin/appendix', remote: 'origin', branch: 'appendix' })]);
	});

	it('switches, bringing along unsaved work that does not collide', async () => {
		const { root } = await makePublished();
		run(root, 'branch', 'draft');
		writeFileSync(join(root, 'notes.tex'), 'Typed, not saved as a version.\n');
		expect(await gitSwitch(root, 'draft')).toEqual({ ok: true, branch: 'draft' });
		expect(readFileSync(join(root, 'notes.tex'), 'utf8')).toBe('Typed, not saved as a version.\n');
	});

	it('refuses to overwrite unsaved work, and names the file', async () => {
		const { root } = await makePublished();
		const main = out(root, 'branch', '--show-current');
		run(root, 'switch', '-q', '-c', 'draft');
		commit(root, 'main.tex', 'The draft wording.\n', 'Reword');
		run(root, 'switch', '-q', main);
		writeFileSync(join(root, 'main.tex'), 'Typed on main, not saved.\n');
		const res = await gitSwitch(root, 'draft');
		expect(res).toMatchObject({ ok: false, failure: 'dirty', files: [join(root, 'main.tex')] });
		expect(out(root, 'branch', '--show-current')).toBe(main);
		expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('Typed on main, not saved.\n');
	});

	it('starts a branch here, and refuses a name git would not allow or one already taken', async () => {
		const { root } = await makePublished();
		writeFileSync(join(root, 'idea.tex'), 'A new idea.\n');
		expect(await gitCreateBranch(root, 'try-idea')).toEqual({ ok: true, branch: 'try-idea' });
		expect(existsSync(join(root, 'idea.tex'))).toBe(true);
		expect(await gitCreateBranch(root, 'bad name')).toMatchObject({ ok: false, failure: 'invalid' });
		expect(await gitCreateBranch(root, '--orphan')).toMatchObject({ ok: false, failure: 'invalid' });
		expect(await gitCreateBranch(root, 'a..b')).toMatchObject({ ok: false, failure: 'invalid' });
		expect(await gitCreateBranch(root, 'try-idea')).toMatchObject({ ok: false, failure: 'exists' });
	});

	it('takes up a remote branch as a local one that tracks it', async () => {
		const { root, other } = await makePublished();
		run(other, 'switch', '-q', '-c', 'appendix');
		commit(other, 'appendix.tex', 'Appendix.\n', 'Start the appendix');
		run(other, 'push', '-q', '-u', 'origin', 'appendix');
		run(root, 'fetch', '-q');
		expect(await gitTrackBranch(root, 'origin/appendix')).toEqual({ ok: true, branch: 'appendix' });
		expect(readFileSync(join(root, 'appendix.tex'), 'utf8')).toBe('Appendix.\n');
		expect(out(root, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/appendix');
		expect(await gitTrackBranch(root, 'origin/nothing')).toMatchObject({ ok: false, failure: 'missing' });
	});

	it('will not switch to a branch that is not there, or in the middle of a merge', async () => {
		const { root } = await makePublished();
		expect(await gitSwitch(root, 'nothing')).toMatchObject({ ok: false, failure: 'missing' });
		writeFileSync(join(root, '.git', 'MERGE_HEAD'), out(root, 'rev-parse', 'HEAD') + '\n');
		expect(await gitSwitch(root, 'nothing')).toMatchObject({ ok: false, failure: 'busy' });
	});
});

describe.skipIf(!AVAILABLE)('deleting branches, as VS Code does', () => {
	it('deletes a branch whose versions are on another branch, and keeps one whose are not until told', async () => {
		const { root } = await makePublished();
		const main = out(root, 'branch', '--show-current');
		run(root, 'branch', 'merged-draft');
		run(root, 'switch', '-q', '-c', 'camera-ready');
		commit(root, 'final.tex', 'Final.\n', 'Camera-ready tweaks');
		run(root, 'switch', '-q', main);

		expect(await gitDeleteBranch(root, 'merged-draft')).toEqual({ ok: true });
		expect(await gitDeleteBranch(root, 'camera-ready')).toMatchObject({ ok: false, failure: 'unmerged' });
		expect(out(root, 'branch', '--list', 'camera-ready')).not.toBe('');
		expect(await gitDeleteBranch(root, 'camera-ready', true)).toEqual({ ok: true });
		expect(out(root, 'branch', '--list', 'camera-ready')).toBe('');
	});

	it('never deletes the branch checked out, or one that is not there', async () => {
		const { root } = await makePublished();
		const main = out(root, 'branch', '--show-current');
		expect(await gitDeleteBranch(root, main, true)).toMatchObject({ ok: false, failure: 'current' });
		expect(await gitDeleteBranch(root, 'nope')).toMatchObject({ ok: false, failure: 'missing' });
		expect(await gitDeleteBranch(root, '--all')).toMatchObject({ ok: false, failure: 'missing' });
	});

	it('deletes a branch on the remote, but not the one this branch syncs with', async () => {
		const { root, remote } = await makePublished();
		const main = out(root, 'branch', '--show-current');
		run(root, 'push', '-q', 'origin', `${main}:old-draft`);
		run(root, 'fetch', '-q');

		expect(await gitDeleteRemoteBranch(root, 'origin/old-draft')).toEqual({ ok: true, remote: 'origin' });
		expect(out(remote, 'branch', '--list', 'old-draft')).toBe('');
		// and the copy of it here goes too
		expect(out(root, 'branch', '-r', '--list', 'origin/old-draft')).toBe('');
		expect(await gitDeleteRemoteBranch(root, `origin/${main}`)).toMatchObject({ ok: false, failure: 'current' });
		expect(await gitDeleteRemoteBranch(root, 'origin/nope')).toMatchObject({ ok: false, failure: 'missing' });
	});
});

describe('reading the branch list', () => {
	it("skips the remote's HEAD and keeps slashes in branch names", () => {
		const raw = [
			'refs/heads/main\x1fmain\x1forigin/main\x1f2026-01-02T00:00:00Z',
			'refs/heads/topic/a\x1ftopic/a\x1f\x1f2026-01-01T00:00:00Z',
			'refs/remotes/origin/HEAD\x1forigin/HEAD\x1f\x1f',
			'refs/remotes/origin/main\x1forigin/main\x1f\x1f2026-01-02T00:00:00Z',
			'refs/remotes/origin/feature/x\x1forigin/feature/x\x1f\x1f2026-01-03T00:00:00Z'
		].join('\n');
		const { local, remote } = parseRefs(raw);
		expect(local.map((b) => [b.name, b.upstream])).toEqual([
			['main', 'origin/main'],
			['topic/a', null]
		]);
		expect(remote).toEqual([{ name: 'origin/feature/x', remote: 'origin', branch: 'feature/x', date: '2026-01-03T00:00:00Z' }]);
	});
});
