// Cases that used to go wrong quietly, against real repositories (gitLiveFixture.ts): a restore that
// replaced a file no version had, a name git printed in quotes, a save that reached past the
// project folder, a hook reported as git missing, a clone whose files never arrived, and a branch
// name that waited twenty seconds to be refused.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { gitStage, gitUnstage, gitCommit, isLocked } from '../../../../../../electron/src/gitService';
import { gitChangesSince, gitRestore } from '../../../../../../electron/src/gitHistory';
import { gitClone } from '../../../../../../electron/src/gitClone';
import { AVAILABLE, run, out, identify, commit, tempDir, removeTempDirs } from './gitLiveFixture';

afterEach(removeTempDirs);

function makeRepo(): string {
	const root = tempDir('texpile-awkward-');
	run(root, 'init', '-q');
	identify(root);
	return root;
}

describe.skipIf(!AVAILABLE)('restoring a version', () => {
	it('will not replace a new file that is in no version, and names it', async () => {
		const root = makeRepo();
		commit(root, 'abstract.tex', 'Old abstract.\n', 'With an abstract');
		const withAbstract = out(root, 'rev-parse', 'HEAD');
		run(root, 'rm', '-q', 'abstract.tex');
		run(root, 'commit', '-q', '-m', 'Drop the abstract');
		writeFileSync(join(root, 'abstract.tex'), 'A new abstract, never saved in a version.\n');

		const res = await gitRestore(root, withAbstract, 'Back to the abstract');
		expect(res).toMatchObject({ ok: false, untracked: [join(root, 'abstract.tex')] });
		expect(readFileSync(join(root, 'abstract.tex'), 'utf8')).toBe('A new abstract, never saved in a version.\n');
	});

	it('restores a file whose name git would print in quotes', async () => {
		const root = makeRepo();
		const name = 'Notes on "Hamlet".tex';
		commit(root, name, 'First reading.\n', 'First');
		const first = out(root, 'rev-parse', 'HEAD');
		commit(root, name, 'Second reading.\n', 'Second');

		expect((await gitChangesSince(root, first)).entries).toEqual([{ path: join(root, name), status: 'M' }]);
		expect((await gitRestore(root, first, 'Back to the first reading')).ok).toBe(true);
		expect(readFileSync(join(root, name), 'utf8')).toBe('First reading.\n');
	});

	it('refuses a revision that is not a version id', async () => {
		const root = makeRepo();
		commit(root, 'a.tex', 'A.\n', 'A');
		expect(await gitChangesSince(root, '--output=/tmp/x')).toMatchObject({ ok: false });
		expect(await gitRestore(root, '--output=/tmp/x', 'x')).toMatchObject({ ok: false });
	});
});

describe.skipIf(!AVAILABLE)('a project that is one folder of a larger repository', () => {
	it('saves a version without touching what was staged outside the folder', async () => {
		const root = makeRepo();
		mkdirSync(join(root, 'thesis'));
		mkdirSync(join(root, 'code'));
		commit(root, 'code/analysis.py', 'print(1)\n', 'Code');
		commit(root, 'thesis/main.tex', 'Thesis.\n', 'Thesis');
		// half of a change staged by hand in a terminal, the rest left out
		writeFileSync(join(root, 'code/analysis.py'), 'print(2)\n');
		run(root, 'add', 'code/analysis.py');
		writeFileSync(join(root, 'code/analysis.py'), 'print(3)\n');
		writeFileSync(join(root, 'thesis/main.tex'), 'Thesis, revised.\n');

		const project = join(root, 'thesis');
		await gitUnstage(project, []);
		await gitStage(project, []);
		expect(out(root, 'status', '--porcelain', '--', 'code')).toBe('MM code/analysis.py');
		expect(out(root, 'diff', '--cached', '--name-only')).toBe('code/analysis.py\nthesis/main.tex');
	});
});

describe.skipIf(!AVAILABLE || process.platform === 'win32')('a hook that fails', () => {
	it("is reported in its own words, not as git missing, when it runs a tool that isn't there", async () => {
		const root = makeRepo();
		commit(root, 'a.tex', 'A.\n', 'A');
		const hook = join(root, '.git', 'hooks', 'pre-commit');
		writeFileSync(hook, '#!/bin/bash\nlint-staged-that-is-not-installed\n');
		chmodSync(hook, 0o755);
		writeFileSync(join(root, 'a.tex'), 'A, changed.\n');
		run(root, 'add', 'a.tex');
		const res = await gitCommit(root, 'Change');
		expect(res.ok).toBe(false);
		expect(res.reason).toBeUndefined();
		expect(res.error).toMatch(/command not found/);
	});
});

describe.skipIf(!AVAILABLE)('a clone whose files could not be written', () => {
	it('fails as such, and leaves no half-made folder behind', async () => {
		const source = makeRepo();
		commit(source, '.gitattributes', 'fig.png filter=broken\n', 'Attributes');
		commit(source, 'fig.png', 'not really a picture\n', 'Figure');
		const parent = tempDir('texpile-clone-');
		// a filter that must run and fails, as a Git LFS download that fails does
		const saved = { ...process.env };
		Object.assign(process.env, {
			GIT_CONFIG_COUNT: '2',
			GIT_CONFIG_KEY_0: 'filter.broken.smudge',
			GIT_CONFIG_VALUE_0: 'false',
			GIT_CONFIG_KEY_1: 'filter.broken.required',
			GIT_CONFIG_VALUE_1: 'true'
		});
		try {
			const res = await gitClone(source, parent, 'paper');
			expect(res).toMatchObject({ ok: false, failure: 'checkout' });
			expect(existsSync(join(parent, 'paper'))).toBe(false);
		} finally {
			for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1']) {
				if (saved[k] === undefined) delete process.env[k];
				else process.env[k] = saved[k];
			}
		}
	});
});

describe('a ref name another one is in the way of', () => {
	// a fetch can meet it too: "draft/v2" on the remote beside a "draft" this copy still has
	it('is not taken for a lock, so it is not retried for 19 seconds', () => {
		expect(isLocked(new Error("error: cannot lock ref 'refs/remotes/origin/draft/v2': 'refs/remotes/origin/draft' exists"))).toBe(false);
		expect(isLocked(new Error("fatal: Unable to create '/p/.git/index.lock': File exists."))).toBe(true);
		expect(isLocked(new Error("error: cannot lock ref 'refs/heads/main': is at 1a2b but expected 3c4d"))).toBe(true);
	});
});
