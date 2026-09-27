// A file name is that file, never a pattern. To git, "a[1].tex" after `--` is a wildcard that also
// matches a1.tex: discarding the one threw away the other's changes, and the Timeline mixed their
// histories. The helper process runs every git with GIT_LITERAL_PATHSPECS (gitProcessEnv.ts); these
// run the same way, against real repositories (gitLiveFixture.ts).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GIT_PROCESS_ENV } from '../../../../../../electron/src/gitProcessEnv';
import { gitDiscard, gitStage, gitCommit, gitUnstage } from '../../../../../../electron/src/gitService';
import { gitFileLog, gitRestore } from '../../../../../../electron/src/gitHistory';
import { AVAILABLE, run, out, identify, commit, tempDir, removeTempDirs } from './gitLiveFixture';

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
	for (const [k, v] of Object.entries(GIT_PROCESS_ENV)) {
		saved[k] = process.env[k];
		process.env[k] = v;
	}
});
afterAll(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});
afterEach(removeTempDirs);

function makeRepo(): string {
	const root = tempDir('texpile-literal-');
	run(root, 'init', '-q');
	identify(root);
	commit(root, 'a1.tex', 'one\n', 'Add a1');
	commit(root, 'a[1].tex', 'bracket\n', 'Add the bracketed one');
	return root;
}

describe.skipIf(!AVAILABLE)('file names with [ ] in them', () => {
	it('discards only the file named, not one its name matches as a pattern', async () => {
		const root = makeRepo();
		writeFileSync(join(root, 'a1.tex'), 'one, still being written\n');
		writeFileSync(join(root, 'a[1].tex'), 'bracket, changed\n');
		expect((await gitDiscard(root, [join(root, 'a[1].tex')])).ok).toBe(true);
		expect(readFileSync(join(root, 'a[1].tex'), 'utf8')).toBe('bracket\n');
		expect(readFileSync(join(root, 'a1.tex'), 'utf8')).toBe('one, still being written\n');
	});

	it('saves only the file ticked', async () => {
		const root = makeRepo();
		writeFileSync(join(root, 'a1.tex'), 'one, not ready\n');
		writeFileSync(join(root, 'a[1].tex'), 'bracket, ready\n');
		await gitUnstage(root, []);
		await gitStage(root, [join(root, 'a[1].tex')]);
		expect((await gitCommit(root, 'Only the bracketed one')).ok).toBe(true);
		expect(out(root, 'show', '--name-only', '--format=', 'HEAD')).toBe('a[1].tex');
	});

	it("lists only that file's versions in the Timeline", async () => {
		const root = makeRepo();
		commit(root, 'a1.tex', 'one again\n', 'Edit a1');
		const log = await gitFileLog(root, join(root, 'a[1].tex'));
		expect(log.entries?.map((e) => e.subject)).toEqual(['Add the bracketed one']);
	});

	it('restores a version from before the bracketed file existed by removing it', async () => {
		const root = makeRepo();
		const before = out(root, 'rev-parse', 'HEAD~1');
		expect((await gitRestore(root, before, 'Back to a1 only')).ok).toBe(true);
		expect(existsSync(join(root, 'a[1].tex'))).toBe(false);
		expect(existsSync(join(root, 'a1.tex'))).toBe(true);
	});
});
