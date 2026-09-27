// git backing for the Source Control panel. Kept out of fsService.ts so that module stays
// dependency-free; every function returns { ok, reason|error } and never throws
import { simpleGit, type SimpleGit, type FileStatusResult } from 'simple-git';
import { dirname, resolve, relative, join, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { unsafeRepoFrom } from './unsafeRepo';
import { FOLDER_ROW_AT, capRows, collapseUntracked } from './gitStatusLimit';
import { hasConflictMarkers } from './conflictMarkers';

// once git is confirmed missing (ENOENT), stop retrying
let gitBinaryMissing = false;

// A repo root stays a repo root, so a hit is cached for good. A MISS is not: `git init` in a
// terminal made a folder a repo and the cached "no" kept the panel saying it was not under source
// control for the rest of the session. Short enough to self-heal, long enough that the status
// polling does not spawn a checkIsRepo every time.
const MISS_TTL_MS = 5000;
const repoRootCache = new Map<string, { root: string | null; at: number }>();

// a repository's git directory, by repo root: where MERGE_HEAD and friends live (not always
// <root>/.git - a worktree or a submodule keeps it elsewhere)
const gitDirCache = new Map<string, { gitDir: string; commonDir: string }>();

export type GitStatusEntry = {
	/** absolute path, built to match the file-tree's own path strings (fsService join()). */
	path: string;
	/** index (staged) status char, e.g. 'M'/'A'/'D'/'R'; ' ' if not staged, '?' if untracked. */
	x: string;
	/** working-dir (unstaged) status char; ' ' if clean, '?' if untracked. */
	y: string;
	/** a file both sides changed that still holds a place marked for someone to choose. Only set
	 *  on those files: once every place is chosen it is ready to finish the merge with. */
	markers?: boolean;
	/** a folder of new files shown as one row (gitStatusLimit.ts): how many files it holds */
	files?: number;
};

export type GitStatusResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	/** reason 'unsafe': the repository git will not work in, as git names it */
	unsafe?: string;
	error?: string;
	/** the list was cut (gitStatusLimit.ts MAX_ROWS): how many rows there were */
	truncated?: number;
	branch?: string | null;
	entries?: GitStatusEntry[];
	/** the upstream this branch tracks ('origin/master'), or null if it tracks nothing */
	tracking?: string | null;
	/** versions here the upstream does not have. Read from local refs, so it costs no network and
	 *  cannot be stale; `behind` is the same read and is therefore only as fresh as the last fetch. */
	ahead?: number;
	behind?: number;
	/** false before the first version: there is nothing to publish yet. Only read when the branch
	 *  tracks nothing, since a tracked branch has commits by definition. */
	hasCommits?: boolean;
	/** HEAD is a commit rather than a branch, so there is no branch to publish or sync */
	detached?: boolean;
	/** the commit HEAD points at ('' before the first); when it moves, History is stale */
	head?: string;
	/** git is part-way through combining histories, started by Sync or in a terminal: until it is
	 *  finished or cancelled, a Save version would record it half-done */
	operation?: GitOperation | null;
	/** where the repository starts: the folder itself, or one above it */
	repoRoot?: string;
};

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export type GitShowResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
	/** false when the file has no committed baseline (unborn HEAD, or an untracked/new file);
	 *  the caller diffs against empty content. */
	hasHead: boolean;
	content?: string;
};

export type GitOpResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
};

/** exported for gitRemote.ts, like the three below */
export function git(baseDir: string): SimpleGit {
	return simpleGit({
		baseDir,
		binary: 'git',
		maxConcurrentProcesses: 4,
		timeout: { block: 20000 },
		// git octal-escapes any non-ASCII path it prints, which then matches no file on disk. On the
		// factory, so it covers the output simple-git parses itself too.
		config: ['core.quotePath=false']
	});
}

// another git holds the lock: a terminal, another editor's own status poll. Texpile's own status
// takes no lock (GIT_OPTIONAL_LOCKS in helper/helperWorker.ts), but it cannot speak for them.
const LOCKED_RE = /index\.lock|unable to create '[^']*\.lock'|cannot lock ref/i;

/** once more after a moment when the repository was locked, which is usually over by then */
export async function retryLocked<T>(run: () => Promise<T>, wait = 400): Promise<T> {
	try {
		return await run();
	} catch (e) {
		if (!LOCKED_RE.test(errMsg(e))) throw e;
		await new Promise((r) => setTimeout(r, wait));
		return run();
	}
}

export function isMissingGit(e: unknown): boolean {
	if ((e as { code?: string })?.code === 'ENOENT') return true;
	const msg = e instanceof Error ? e.message : String(e);
	return /ENOENT|not recognized as|command not found|is not recognized/i.test(msg);
}

export function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** resolves the enclosing repo's root, cached. Flat shape (root|null + optional reason), not a
 *  discriminated union: the union form tripped svelte-check's cross-config narrowing. */
export async function resolveRepoRoot(
	dir: string
): Promise<{ root: string | null; reason?: 'not-a-repo' | 'no-git' | 'unsafe'; unsafe?: string }> {
	if (gitBinaryMissing) return { root: null, reason: 'no-git' };
	// case-fold the cache key only on case-insensitive filesystems; on Linux /proj/Foo
	// and /proj/foo are different directories and must not collide
	const abs = resolve(dir);
	const key = process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs;
	const cached = repoRootCache.get(key);
	if (cached?.root) return { root: cached.root };
	if (cached && Date.now() - cached.at < MISS_TTL_MS) return { root: null, reason: 'not-a-repo' };
	try {
		const g = git(dir);
		// checkIsRepo returns false for a non-repo; it throws ENOENT if git is absent
		if (!(await g.checkIsRepo())) {
			repoRootCache.set(key, { root: null, at: Date.now() });
			return { root: null, reason: 'not-a-repo' };
		}
		// git names the top level by its physical path; opened through a symlink (macOS /var, a linked
		// home) the folder would relativize to ../.. and every pathspec miss, so walk up by the prefix depth
		const prefix = (await g.revparse(['--show-prefix'])).trim();
		const depth = prefix.split('/').filter(Boolean).length;
		const root = resolve(abs, ...Array<string>(depth).fill('..'));
		repoRootCache.set(key, { root, at: Date.now() });
		return { root };
	} catch (e) {
		if (isMissingGit(e)) {
			gitBinaryMissing = true;
			return { root: null, reason: 'no-git' };
		}
		// a folder another account owns: git will say which, and gitTrust.ts can list it as safe
		const unsafe = unsafeRepoFrom(errMsg(e));
		if (unsafe) return { root: null, reason: 'unsafe', unsafe };
		// permissions or a corrupt repo: treat as not-a-repo but don't cache, could be transient
		return { root: null, reason: 'not-a-repo' };
	}
}

/** absolute paths to repo-root-relative, forward-slashed (what git's pathspecs want). */
export function toRepoRel(repoRoot: string, absPaths: string[]): string[] {
	return absPaths.map((p) => relative(repoRoot, resolve(p)).split(/[\\/]/).join('/'));
}

/** The repository's git directory, and the common one a worktree shares its refs with. Exported
 *  for the watcher (fs/fsWatch.ts), which follows HEAD, the index and the refs from there. */
export async function gitDirsOf(repoRoot: string): Promise<{ gitDir: string; commonDir: string }> {
	const cached = gitDirCache.get(repoRoot);
	if (cached) return cached;
	const g = git(repoRoot);
	const gitDir = resolve(repoRoot, (await g.raw(['rev-parse', '--git-dir'])).trim());
	const commonDir = resolve(repoRoot, (await g.raw(['rev-parse', '--git-common-dir'])).trim());
	const dirs = { gitDir, commonDir };
	gitDirCache.set(repoRoot, dirs);
	return dirs;
}

/** what git leaves behind while an operation waits for someone to finish it. rebase-apply is also
 *  `git am`, which is the same kind of unfinished for this purpose. */
export function operationIn(gitDir: string): GitOperation | null {
	if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) return 'rebase';
	if (existsSync(join(gitDir, 'MERGE_HEAD'))) return 'merge';
	if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
	if (existsSync(join(gitDir, 'REVERT_HEAD'))) return 'revert';
	return null;
}

/** a history or remote call found git missing: stop asking until "Check again" */
export function markGitMissing(): void {
	gitBinaryMissing = true;
}

/** "Check again" after installing git: forget that it was missing, and every repository answer. */
export async function gitRecheck(): Promise<GitOpResult> {
	gitBinaryMissing = false;
	repoRootCache.clear();
	gitDirCache.clear();
	return { ok: true };
}

/** status of every changed file under the workspace + the current branch. Paths are re-derived
 *  against the workspace root to match the file-tree's paths byte-for-byte, which keeps it correct
 *  when the workspace is a subdirectory of a larger repo. */
/** git's unmerged status codes: a U on either side, or both sides adding or deleting the same path */
export function isUnmerged(x: string, y: string): boolean {
	return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

/** a deleted or unreadable file has nothing marked in it */
export async function stillMarked(abs: string): Promise<boolean> {
	try {
		return hasConflictMarkers(await readFile(abs, 'utf8'));
	} catch {
		return false;
	}
}

/** big folders of new files as one row each; git is asked which folders are wholly new only when
 *  there are enough new files for one to qualify */
async function withFolderRows(g: SimpleGit, workspaceRoot: string, entries: GitStatusEntry[]): Promise<GitStatusEntry[]> {
	if (entries.filter((e) => e.x === '?').length < FOLDER_ROW_AT) return entries;
	const raw = await g.raw(['ls-files', '--others', '--exclude-standard', '--directory', '--no-empty-directory', '-z']);
	const folders = raw
		.split('\0')
		.filter((p) => p.endsWith('/'))
		.map((p) => join(workspaceRoot, p));
	return collapseUntracked(entries, folders);
}

export async function gitStatus(workspaceRoot: string): Promise<GitStatusResult> {
	if (!workspaceRoot) return { ok: false, error: 'Missing path' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason, unsafe: rr.unsafe };
	const repoRoot = rr.root;
	try {
		const g = git(workspaceRoot);
		const status = await g.status(['--untracked-files=all']);
		// with -q, an unborn HEAD exits non-zero and prints nothing, which simple-git resolves as ''
		const head = (await g.raw(['rev-parse', '--verify', '-q', 'HEAD'])).trim();
		const operation = operationIn((await gitDirsOf(repoRoot)).gitDir);
		const wsAbs = resolve(workspaceRoot);
		const entries: GitStatusEntry[] = [];
		for (const f of status.files as FileStatusResult[]) {
			const absFromRepo = resolve(repoRoot, f.path);
			// '' = the workspace root itself; '..'-prefixed = above it; absolute = a different drive
			const rel = relative(wsAbs, absFromRepo);
			if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
			const entry: GitStatusEntry = { path: join(workspaceRoot, rel), x: f.index, y: f.working_dir };
			if (isUnmerged(f.index, f.working_dir)) entry.markers = await stillMarked(absFromRepo);
			entries.push(entry);
		}
		const { rows, truncated } = capRows(await withFolderRows(g, workspaceRoot, entries));
		return {
			ok: true,
			branch: status.current,
			entries: rows,
			truncated,
			tracking: status.tracking ?? null,
			ahead: status.ahead,
			behind: status.behind,
			hasCommits: head !== '',
			detached: status.detached,
			head,
			operation,
			repoRoot
		};
	} catch (e) {
		if (isMissingGit(e)) {
			gitBinaryMissing = true;
			return { ok: false, reason: 'no-git' };
		}
		return { ok: false, error: errMsg(e) };
	}
}

/** committed (HEAD) contents of a file, for diffing against the working copy. */
export async function gitShowHead(absPath: string): Promise<GitShowResult> {
	if (!absPath) return { ok: false, hasHead: false, error: 'Missing path' };
	const rr = await resolveRepoRoot(dirname(absPath));
	if (!rr.root) return { ok: false, hasHead: false, reason: rr.reason };
	const repoRoot = rr.root;
	try {
		const [rel] = toRepoRel(repoRoot, [absPath]);
		const content = await git(repoRoot).show([`HEAD:${rel}`]);
		return { ok: true, hasHead: true, content };
	} catch (e) {
		if (isMissingGit(e)) {
			gitBinaryMissing = true;
			return { ok: false, hasHead: false, reason: 'no-git' };
		}
		const msg = errMsg(e);
		// unborn HEAD, untracked file, or path not in HEAD: no baseline, not an error
		if (/exists on disk, but not in|does not exist in|unknown revision|bad revision|invalid object name|ambiguous argument/i.test(msg)) {
			return { ok: true, hasHead: false, content: '' };
		}
		return { ok: false, hasHead: false, error: msg };
	}
}

/** git init the folder; clears the repo-root cache so subsequent status calls see the new repo. */
export async function gitInit(dir: string): Promise<GitOpResult> {
	if (!dir) return { ok: false, error: 'Missing path' };
	if (gitBinaryMissing) return { ok: false, reason: 'no-git' };
	try {
		const g = git(dir);
		// a branch named `main`, which is what GitHub and VS Code start with, unless the author has
		// chosen a default of their own; git before 2.28 has no -b and names it itself
		const chosen = (await g.raw(['config', '--get', 'init.defaultBranch']).catch(() => '')).trim();
		if (chosen) await g.init();
		else await g.raw(['init', '-b', 'main']).catch(() => g.init());
		repoRootCache.clear();
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) {
			gitBinaryMissing = true;
			return { ok: false, reason: 'no-git' };
		}
		return { ok: false, error: errMsg(e) };
	}
}

/** stage files (git add). Empty `paths` stages everything under the workspace. */
export async function gitStage(workspaceRoot: string, paths: string[]): Promise<GitOpResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	try {
		const rel = toRepoRel(rr.root, paths);
		await retryLocked(() => git(root).add(rel.length ? rel : ['.']));
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/** unstage files (git reset HEAD). Falls back to `git rm --cached` before the first commit,
 *  since an unborn HEAD can't be reset against. Empty `paths` unstages everything. */
export async function gitUnstage(workspaceRoot: string, paths: string[]): Promise<GitOpResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const g = git(rr.root);
	const rel = toRepoRel(rr.root, paths);
	try {
		await retryLocked(() => g.raw(['reset', '-q', 'HEAD', '--', ...(rel.length ? rel : ['.'])]));
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		// Only with no commits yet, where reset has no HEAD to go back to. Any other failure is
		// reported as it is: a reset that lost a race for .git/index.lock against a status refresh
		// used to land here too, and `rm --cached -r .` over a whole repository with history makes
		// the next version delete every file that was not ticked.
		if ((await g.raw(['rev-parse', '--verify', '-q', 'HEAD']).catch(() => 'unknown')).trim() !== '') {
			return { ok: false, error: errMsg(e) };
		}
		try {
			await g.raw(['rm', '-q', '--cached', '-r', '--', ...(rel.length ? rel : ['.'])]);
			return { ok: true };
		} catch (e2) {
			return { ok: false, error: errMsg(e2) };
		}
	}
}

/** discard unstaged changes to tracked files (git checkout). Untracked-file deletion is the
 *  caller's job, via the fs service. */
export async function gitDiscard(workspaceRoot: string, paths: string[]): Promise<GitOpResult> {
	if (!paths.length) return { ok: false, error: 'No files to discard' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	try {
		const rel = toRepoRel(rr.root, paths);
		await retryLocked(() => git(root).raw(['checkout', '-q', '--', ...rel]));
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/**
 * The repo's configured author name and email, for attributing review comments and for showing
 * people which identity git will use.
 *
 * Reads the same `user.name` a commit would, so a comment and a commit from the same person carry
 * the same name and nobody has to be told twice who they are. Returns null for every failure -
 * no git, not a repo, name unset - because the caller has its own fallbacks and none of those is
 * an error worth surfacing.
 */
export async function gitIdentity(workspaceRoot: string): Promise<{ ok: true; name: string | null; email: string | null }> {
	if (!workspaceRoot || gitBinaryMissing) return { ok: true, name: null, email: null };
	const read = async (key: string): Promise<string | null> => {
		try {
			// --get walks the whole config chain (local, global, system), which is what makes this work
			// in a repo whose author is set once, machine-wide
			return (await git(workspaceRoot).raw(['config', '--get', key])).trim() || null;
		} catch (e) {
			if (isMissingGit(e)) gitBinaryMissing = true;
			return null;
		}
	};
	return { ok: true, name: await read('user.name'), email: await read('user.email') };
}

/**
 * Tell git who is committing, for every repository on this machine: the same `--global` the
 * install guide has people type, so a name set here is the name a terminal commit uses too.
 * Only what was given is written; an empty field leaves that setting as it was.
 */
export async function gitSetIdentity(workspaceRoot: string, name: string, email: string): Promise<GitOpResult> {
	if (!workspaceRoot) return { ok: false, error: 'Missing path' };
	if (gitBinaryMissing) return { ok: false, reason: 'no-git' };
	try {
		const g = git(workspaceRoot);
		if (name.trim()) await g.addConfig('user.name', name.trim(), false, 'global');
		if (email.trim()) await g.addConfig('user.email', email.trim(), false, 'global');
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) {
			gitBinaryMissing = true;
			return { ok: false, reason: 'no-git' };
		}
		return { ok: false, error: errMsg(e) };
	}
}

/** commit the staged changes. Fails if nothing is staged or no author identity is configured. */
export async function gitCommit(workspaceRoot: string, message: string): Promise<GitOpResult> {
	if (!message || !message.trim()) return { ok: false, error: 'A commit message is required' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	try {
		await retryLocked(() => git(root).commit(message));
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}
