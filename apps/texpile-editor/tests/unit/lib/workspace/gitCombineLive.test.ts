// Combining two lines of work in the app, against real repos (gitLiveFixture.ts): Sync backs out
// of a conflict, Combine starts that merge for real and leaves the marked places, Finish refuses
// while one is left and saves the merge once none is, and Cancel puts everything back.
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gitStatus } from '../../../../../../electron/src/gitService';
import { gitSync } from '../../../../../../electron/src/gitRemote';
import { gitCombine, gitFinishCombine, gitCancelCombine, gitKeepSide } from '../../../../../../electron/src/gitCombine';
import { hasConflictMarkers } from '../../../../../../electron/src/conflictMarkers';
import { AVAILABLE, run, out, commit, removeTempDirs, makePublished } from './gitLiveFixture';

afterEach(removeTempDirs);

/** both sides changed the first line of main.tex, and Sync has just backed out of joining them */
async function makeConflicted() {
	const fixture = await makePublished();
	const { root, other } = fixture;
	commit(other, 'main.tex', 'Their first line.\nSecond line.\n', 'Their edit');
	commit(other, 'notes.tex', 'Their notes.\n', 'Their notes');
	run(other, 'push', '-q');
	commit(root, 'main.tex', 'My first line.\nSecond line.\n', 'My edit');
	expect(await gitSync(root)).toMatchObject({ ok: false, failure: 'conflict', files: ['main.tex'] });
	return { ...fixture, head: out(root, 'rev-parse', 'HEAD') };
}

describe.skipIf(!AVAILABLE)('combining two lines of work', () => {
	it('starts the merge Sync backed out of, and leaves the place both changed marked', async () => {
		const { root } = await makeConflicted();
		const res = await gitCombine(root);
		expect(res.ok).toBe(true);
		expect(res.conflicts).toEqual([join(root, 'main.tex')]);
		expect(res.with).toMatch(/origin\//);

		const text = readFileSync(join(root, 'main.tex'), 'utf8');
		expect(text).toContain('<<<<<<< ');
		expect(text).toContain('My first line.');
		expect(text).toContain('Their first line.');
		// the other side is named as the author knows it, not as @{u}
		expect(text).toMatch(/^>>>>>>> origin\/\w+$/m);
		// what git could join by itself is already there
		expect(readFileSync(join(root, 'notes.tex'), 'utf8')).toBe('Their notes.\n');

		const status = await gitStatus(root);
		expect(status.operation).toBe('merge');
		expect(status.entries?.find((e) => e.path === join(root, 'main.tex'))).toMatchObject({ x: 'U', y: 'U', markers: true });
		// a file the merge took in cleanly is not a conflict and carries no flag at all
		expect(status.entries?.find((e) => e.path === join(root, 'notes.tex'))?.markers).toBeUndefined();
	});

	it('will not finish while a place still holds both versions', async () => {
		const { root, head } = await makeConflicted();
		await gitCombine(root);
		const res = await gitFinishCombine(root);
		expect(res).toMatchObject({ ok: false, failure: 'markers', files: [join(root, 'main.tex')] });
		expect(out(root, 'rev-parse', 'HEAD')).toBe(head);
		expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(true);
	});

	it('saves the merge as one version once every place is chosen, ready to send', async () => {
		const { root, remote, head } = await makeConflicted();
		await gitCombine(root);
		writeFileSync(join(root, 'main.tex'), 'My first line.\nTheir first line.\nSecond line.\n');
		expect((await gitStatus(root)).entries?.find((e) => e.path === join(root, 'main.tex'))?.markers).toBe(false);

		expect(await gitFinishCombine(root)).toEqual({ ok: true });
		expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(false);
		// a merge: this side's version and theirs are its two parents, under git's own message
		const parents = out(root, 'log', '-1', '--format=%P').split(' ');
		expect(parents).toHaveLength(2);
		expect(parents[0]).toBe(head);
		expect(out(root, 'log', '-1', '--format=%s')).toMatch(/^Merge /);
		const status = await gitStatus(root);
		expect(status.operation).toBeNull();
		expect(status.entries).toEqual([]);
		expect(status.ahead).toBe(2);

		const sent = await gitSync(root);
		expect(sent).toMatchObject({ ok: true, pulled: 0, pushed: 2 });
		const branch = out(root, 'branch', '--show-current');
		expect(out(remote, 'rev-parse', branch)).toBe(out(root, 'rev-parse', 'HEAD'));
	});

	it('settles a file one side deleted by its absence', async () => {
		const { root, other } = await makePublished();
		commit(other, 'main.tex', 'Their first line.\nSecond line.\n', 'Their edit');
		run(other, 'push', '-q');
		run(root, 'rm', '-q', 'main.tex');
		run(root, 'commit', '-q', '-m', 'Drop main.tex');
		expect((await gitSync(root)).failure).toBe('conflict');
		expect((await gitCombine(root)).conflicts).toEqual([join(root, 'main.tex')]);
		// git leaves their copy in place; the author keeps it deleted, and a file that is not there
		// has nothing marked in it
		expect(existsSync(join(root, 'main.tex'))).toBe(true);
		rmSync(join(root, 'main.tex'));
		expect(await gitFinishCombine(root)).toEqual({ ok: true });
		expect(out(root, 'ls-files', 'main.tex')).toBe('');
	});

	it('puts everything back when cancelled', async () => {
		const { root, head } = await makeConflicted();
		await gitCombine(root);
		// a choice made before changing their mind goes with the rest
		writeFileSync(join(root, 'main.tex'), 'Half chosen.\n');

		expect(await gitCancelCombine(root)).toEqual({ ok: true });
		expect(out(root, 'rev-parse', 'HEAD')).toBe(head);
		expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(false);
		expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('My first line.\nSecond line.\n');
		expect(existsSync(join(root, 'notes.tex'))).toBe(false);
		expect((await gitStatus(root)).entries).toEqual([]);
		// nothing left to cancel is not a failure
		expect(await gitCancelCombine(root)).toEqual({ ok: true });
	});

	it('does not start over unsaved work, or over a merge already under way', async () => {
		const { root } = await makeConflicted();
		writeFileSync(join(root, 'main.tex'), 'Typed, not saved as a version.\n');
		expect(await gitCombine(root)).toMatchObject({ ok: false, failure: 'dirty', files: [join(root, 'main.tex')] });
		expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('Typed, not saved as a version.\n');

		run(root, 'checkout', '-q', '--', 'main.tex');
		expect((await gitCombine(root)).ok).toBe(true);
		expect(await gitCombine(root)).toMatchObject({ ok: false, failure: 'busy' });
	});

	it('has nothing to finish when no merge is under way', async () => {
		const { root } = await makePublished();
		expect(await gitFinishCombine(root)).toMatchObject({ ok: false, failure: 'not-combining' });
	});
});

describe('the marker check on the git side', () => {
	it('needs all three markers, in order, each at the start of a line', () => {
		expect(hasConflictMarkers('a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> origin/main\nb\n')).toBe(true);
		expect(hasConflictMarkers('<<<<<<< HEAD\r\nx\r\n=======\r\ny\r\n>>>>>>> b')).toBe(true);
		expect(hasConflictMarkers('<<<<<<< HEAD\nx\n=======\ny\n')).toBe(false);
		expect(hasConflictMarkers('=======\n<<<<<<< HEAD\n>>>>>>> b\n')).toBe(false);
		expect(hasConflictMarkers(' <<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n')).toBe(false);
		expect(hasConflictMarkers('<<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b\n')).toBe(false);
		expect(hasConflictMarkers('plain text\n')).toBe(false);
	});
});

describe.skipIf(!AVAILABLE)('keeping one side of a whole file', () => {
	it('takes their file as it is, leaves it in the merge ready, and Finish records it', async () => {
		const { root } = await makeConflicted();
		await gitCombine(root);
		expect(await gitKeepSide(root, join(root, 'main.tex'), 'theirs')).toEqual({ ok: true });
		expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('Their first line.\nSecond line.\n');
		expect((await gitStatus(root)).entries?.find((e) => e.path === join(root, 'main.tex'))).toMatchObject({ markers: false });
		expect(await gitFinishCombine(root)).toEqual({ ok: true });
	});

	it('keeps a file deleted when the side kept had deleted it', async () => {
		const fixture = await makePublished();
		const { root, other } = fixture;
		run(other, 'rm', '-q', 'main.tex');
		run(other, 'commit', '-qm', 'Drop main');
		run(other, 'push', '-q');
		commit(root, 'main.tex', 'My first line.\nSecond line.\n', 'My edit');
		await gitSync(root);
		await gitCombine(root);
		expect(await gitKeepSide(root, join(root, 'main.tex'), 'theirs')).toEqual({ ok: true });
		expect(existsSync(join(root, 'main.tex'))).toBe(false);
		expect(await gitFinishCombine(root)).toEqual({ ok: true });
	});

	it('refuses outside a merge, and a path outside the repository', async () => {
		const { root } = await makePublished();
		expect((await gitKeepSide(root, join(root, 'main.tex'), 'mine')).ok).toBe(false);
		expect((await gitKeepSide(root, join(root, '..', 'elsewhere.tex'), 'mine')).ok).toBe(false);
	});
});
