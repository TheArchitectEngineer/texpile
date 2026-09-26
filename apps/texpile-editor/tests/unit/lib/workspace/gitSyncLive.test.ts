// Publishing a branch and syncing it, against real repos. A bare repo in a temp dir stands in for
// GitHub: it can be published to, moved ahead from a second clone, and made to conflict, with no
// network and no credentials. Sign-in itself is covered by the askpass and GitHub tests.
//
// Skips itself when git is not on PATH, like the other live git fixtures.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitStatus, gitIdentity, gitSetIdentity } from '../../../../../../electron/src/gitService';
import { gitPublish, gitSync, gitPush, gitRemotes, gitAddRemote, gitCredentialFill } from '../../../../../../electron/src/gitRemote';

function hasGit(): boolean {
	try {
		execFileSync('git', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}
const AVAILABLE = hasGit();

const run = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
const out = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root }).toString().trim();

function identify(root: string) {
	run(root, 'config', 'user.email', 'test@example.com');
	run(root, 'config', 'user.name', 'Ada Lovelace');
	run(root, 'config', 'commit.gpgsign', 'false');
}

function commit(root: string, name: string, body: string, subject: string) {
	writeFileSync(join(root, name), body);
	run(root, 'add', '-A');
	run(root, 'commit', '-q', '-m', subject);
}

const dirs: string[] = [];
function tempDir(prefix: string): string {
	const d = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(d);
	return d;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** a project with one version and no remote, and an empty bare repo beside it to publish to */
function makeUnpublished(): { root: string; remote: string; dir: string } {
	const dir = tempDir('texpile-publish-');
	const remote = join(dir, 'remote.git');
	const root = join(dir, 'work');
	execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'ignore' });
	execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
	identify(root);
	commit(root, 'main.tex', 'First line.\nSecond line.\n', 'First draft');
	return { root, remote, dir };
}

/** a published project and a second clone of it: someone else, or the same author elsewhere */
async function makePublished(): Promise<{ root: string; other: string; remote: string }> {
	const { root, remote, dir } = makeUnpublished();
	expect((await gitAddRemote(root, 'origin', remote)).ok).toBe(true);
	expect((await gitPublish(root, 'origin')).ok).toBe(true);
	const other = join(dir, 'other');
	execFileSync('git', ['clone', '-q', remote, other], { stdio: 'ignore' });
	identify(other);
	return { root, other, remote };
}

describe.skipIf(!AVAILABLE)('publishing a branch', () => {
	it('is offered only once there is a version to publish', async () => {
		const root = tempDir('texpile-unborn-');
		run(root, 'init', '-q');
		const before = await gitStatus(root);
		expect(before.hasCommits).toBe(false);

		identify(root);
		commit(root, 'main.tex', 'x\n', 'First draft');
		expect((await gitStatus(root)).hasCommits).toBe(true);
	});

	it('sends the branch and makes the remote its upstream, so upload has somewhere to go', async () => {
		const { root, remote } = makeUnpublished();
		expect((await gitStatus(root)).tracking).toBeNull();

		expect((await gitAddRemote(root, 'origin', remote)).ok).toBe(true);
		expect((await gitRemotes(root)).remotes).toEqual([{ name: 'origin', url: remote }]);

		const res = await gitPublish(root, 'origin');
		expect(res).toMatchObject({ ok: true, remote: 'origin' });

		const after = await gitStatus(root);
		expect(after.tracking).toMatch(/^origin\//);
		expect(after.ahead).toBe(0);
		const branch = out(root, 'branch', '--show-current');
		expect(out(remote, 'log', '--format=%s', branch)).toBe('First draft');

		commit(root, 'main.tex', 'Changed.\n', 'Second draft');
		expect((await gitPush(root)).ok).toBe(true);
	});

	it('refuses a remote name or address that git would read as something else', async () => {
		const { root } = makeUnpublished();
		expect((await gitAddRemote(root, '--upload-pack=touch x', '/tmp/r.git')).ok).toBe(false);
		expect((await gitAddRemote(root, 'origin', '--upload-pack=touch x')).ok).toBe(false);
		expect((await gitAddRemote(root, 'origin', 'ext::sh -c touch% x')).ok).toBe(false);
		expect((await gitRemotes(root)).remotes).toEqual([]);
	});
});

describe.skipIf(!AVAILABLE)('syncing with the remote', () => {
	it('takes in versions made elsewhere when there is nothing to send', async () => {
		const { root, other } = await makePublished();
		commit(other, 'refs.bib', '@book{a,title={A}}\n', 'Add a reference');
		run(other, 'push', '-q');

		const res = await gitSync(root);
		expect(res).toMatchObject({ ok: true, remote: 'origin', pulled: 1, pushed: 0 });
		expect(existsSync(join(root, 'refs.bib'))).toBe(true);
	});

	it('joins two lines of work that touched different files, and sends the result', async () => {
		const { root, other, remote } = await makePublished();
		commit(other, 'theirs.tex', 'Theirs.\n', 'Their version');
		run(other, 'push', '-q');
		commit(root, 'mine.tex', 'Mine.\n', 'My version');

		const res = await gitSync(root);
		expect(res.ok).toBe(true);
		expect(res.pulled).toBe(1);
		// my version and the merge that joined them
		expect(res.pushed).toBe(2);
		expect(existsSync(join(root, 'theirs.tex'))).toBe(true);
		const status = await gitStatus(root);
		expect(status.ahead).toBe(0);
		expect(status.behind).toBe(0);
		const branch = out(root, 'branch', '--show-current');
		expect(out(remote, 'log', '-1', '--format=%P', branch).split(' ')).toHaveLength(2);
	});

	it('undoes the attempt when both sides changed the same lines, and names the file', async () => {
		const { root, other } = await makePublished();
		commit(other, 'main.tex', 'Their first line.\nSecond line.\n', 'Their edit');
		run(other, 'push', '-q');
		commit(root, 'main.tex', 'My first line.\nSecond line.\n', 'My edit');
		const head = out(root, 'rev-parse', 'HEAD');

		const res = await gitSync(root);
		expect(res).toMatchObject({ ok: false, failure: 'conflict', files: ['main.tex'] });

		// exactly as before: same version, no merge under way, no conflict markers in the file
		expect(out(root, 'rev-parse', 'HEAD')).toBe(head);
		expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(false);
		expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('My first line.\nSecond line.\n');
		expect((await gitStatus(root)).entries).toEqual([]);
	});

	it('leaves unsaved work alone when an incoming version would overwrite it', async () => {
		const { root, other } = await makePublished();
		commit(other, 'main.tex', 'Their text.\n', 'Their edit');
		run(other, 'push', '-q');
		writeFileSync(join(root, 'main.tex'), 'Typed, not saved as a version.\n');

		const res = await gitSync(root);
		expect(res).toMatchObject({ ok: false, failure: 'dirty', files: ['main.tex'] });
		expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('Typed, not saved as a version.\n');
	});

	it('will not try to join two histories over unsaved work at all', async () => {
		const { root, other } = await makePublished();
		commit(other, 'theirs.tex', 'Theirs.\n', 'Their version');
		run(other, 'push', '-q');
		commit(root, 'mine.tex', 'Mine.\n', 'My version');
		writeFileSync(join(root, 'main.tex'), 'Half-written.\n');
		const head = out(root, 'rev-parse', 'HEAD');

		const res = await gitSync(root);
		expect(res).toMatchObject({ ok: false, failure: 'dirty', files: ['main.tex'] });
		expect(out(root, 'rev-parse', 'HEAD')).toBe(head);
		expect(readFileSync(join(root, 'main.tex'), 'utf8')).toBe('Half-written.\n');
	});

	it('a branch tracking nothing has nothing to sync with', async () => {
		const { root } = makeUnpublished();
		expect(await gitSync(root)).toMatchObject({ ok: false, failure: 'no-upstream' });
	});
});

describe.skipIf(!AVAILABLE)("the author's own git configuration", () => {
	const saved = process.env.GIT_CONFIG_GLOBAL;
	afterEach(() => {
		if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = saved;
	});

	it('reaches an upload: the environment goes through whole, not as one variable', async () => {
		// the remote's address only resolves through a global `insteadOf`. An upload that saw only
		// GIT_TERMINAL_PROMPT had no HOME and no GIT_CONFIG_GLOBAL, so it could not find it - nor a
		// credential helper configured the same way
		const { root, remote, dir } = makeUnpublished();
		const config = join(dir, 'global.gitconfig');
		writeFileSync(config, `[url "${remote}"]\n\tinsteadOf = elsewhere:thesis\n`);
		process.env.GIT_CONFIG_GLOBAL = config;

		expect((await gitAddRemote(root, 'origin', 'elsewhere:thesis')).ok).toBe(true);
		expect((await gitPublish(root, 'origin')).ok).toBe(true);
		commit(root, 'main.tex', 'Changed.\n', 'Second draft');
		expect((await gitPush(root)).ok).toBe(true);
	});

	it("reads a credential from the author's helper, the way a push would", async () => {
		const dir = tempDir('texpile-cred-');
		const config = join(dir, 'global.gitconfig');
		writeFileSync(config, `[credential]\n\thelper = "!f() { echo username=ada; echo password=token-123; }; f"\n`);
		process.env.GIT_CONFIG_GLOBAL = config;

		const res = await gitCredentialFill(dir, 'github.com');
		expect(res.ok).toBe(true);
		expect(res.credential).toMatchObject({ protocol: 'https', host: 'github.com', username: 'ada', password: 'token-123' });
	});

	it('sets the identity commits are made with, machine-wide', async () => {
		const dir = tempDir('texpile-ident-');
		process.env.GIT_CONFIG_GLOBAL = join(dir, 'global.gitconfig');
		writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
		run(dir, 'init', '-q');

		expect(await gitIdentity(dir)).toMatchObject({ name: null, email: null });
		expect((await gitSetIdentity(dir, ' Ada Lovelace ', 'ada@example.com')).ok).toBe(true);
		expect(await gitIdentity(dir)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
		// an empty field leaves what was there
		expect((await gitSetIdentity(dir, '', 'countess@example.com')).ok).toBe(true);
		expect(await gitIdentity(dir)).toMatchObject({ name: 'Ada Lovelace', email: 'countess@example.com' });
	});
});
