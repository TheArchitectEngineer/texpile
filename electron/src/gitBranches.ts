// Branches for the Source Control panel: the list behind the branch name, switching to one,
// starting one, and taking up one that exists only on a remote. VS Code's Git: Checkout to...,
// with the refusals said in words: git will not switch over unsaved work it would overwrite.
import { git, errMsg, isMissingGit, resolveRepoRoot, retryLocked, gitDirsOf, operationIn, type GitOpResult } from './gitService';
import { OVERWRITE_RE, classifyPushError, netGit, parseBlockingFiles, type GitAuthEnv, type PushFailure } from './gitRemote';
import { resolve } from 'node:path';

export type GitBranch = {
	name: string;
	/** the remote branch it tracks, 'origin/main', or null */
	upstream: string | null;
	/** when the branch last had a version saved to it, ISO 8601 */
	date: string;
};

export type GitRemoteBranch = {
	/** as git names it: 'origin/feature' */
	name: string;
	remote: string;
	/** the branch's own name on that remote: 'feature' */
	branch: string;
	date: string;
};

export type GitBranchesResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
	/** null when HEAD is a commit rather than a branch */
	current?: string | null;
	local?: GitBranch[];
	/** branches on a remote that no local branch tracks yet */
	remote?: GitRemoteBranch[];
};

export type GitSwitchResult = GitOpResult & {
	/** 'dirty': unsaved work the switch would overwrite. 'busy': a merge or rebase is under way.
	 *  'exists': a branch by that name is already there. 'invalid': not a name git allows. */
	failure?: 'dirty' | 'busy' | 'exists' | 'invalid' | 'missing';
	/** what stood in the way of a 'dirty', absolute */
	files?: string[];
	/** the branch now checked out */
	branch?: string;
};

const SEP = '\x1f';

/** exported for the tests: for-each-ref lines of refname, short name, upstream and date */
export function parseRefs(raw: string): { local: GitBranch[]; remote: GitRemoteBranch[] } {
	const local: GitBranch[] = [];
	const remote: GitRemoteBranch[] = [];
	for (const line of raw.split('\n')) {
		const [ref, short, upstream, date] = line.split(SEP);
		if (!ref || !short) continue;
		if (ref.startsWith('refs/heads/')) {
			local.push({ name: short, upstream: upstream || null, date: date ?? '' });
		} else if (ref.startsWith('refs/remotes/')) {
			// refs/remotes/origin/HEAD names the remote's default branch, not a branch of its own
			if (ref.endsWith('/HEAD')) continue;
			const rest = ref.slice('refs/remotes/'.length);
			const cut = rest.indexOf('/');
			if (cut <= 0) continue;
			remote.push({ name: short, remote: rest.slice(0, cut), branch: rest.slice(cut + 1), date: date ?? '' });
		}
	}
	// a remote branch that a local one already tracks is that local branch, as far as switching goes
	const tracked = new Set(local.map((b) => b.upstream).filter(Boolean));
	return { local, remote: remote.filter((r) => !tracked.has(r.name)) };
}

export async function gitBranches(workspaceRoot: string): Promise<GitBranchesResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	try {
		const g = git(rr.root);
		const raw = await g.raw([
			'for-each-ref',
			'--sort=-committerdate',
			`--format=%(refname)${SEP}%(refname:short)${SEP}%(upstream:short)${SEP}%(committerdate:iso-strict)`,
			'refs/heads',
			'refs/remotes'
		]);
		// with -q, a detached HEAD prints nothing and exits 1, which simple-git resolves as ''
		const current = (await g.raw(['symbolic-ref', '-q', '--short', 'HEAD'])).trim() || null;
		return { ok: true, current, ...parseRefs(raw) };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/** a name git allows for a branch; `git check-ref-format --branch` is the authority */
async function validName(root: string, name: string): Promise<boolean> {
	if (!name || name.startsWith('-') || /\s/.test(name)) return false;
	try {
		await git(root).raw(['check-ref-format', '--branch', name]);
		return true;
	} catch {
		return false;
	}
}

async function run(workspaceRoot: string, args: (root: string) => Promise<string[] | GitSwitchResult>): Promise<GitSwitchResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	const g = git(root);
	try {
		if (operationIn((await gitDirsOf(root)).gitDir)) return { ok: false, failure: 'busy' };
		const planned = await args(root);
		if (!Array.isArray(planned)) return planned;
		await retryLocked(() => g.raw(planned));
		const branch = (await g.raw(['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
		return { ok: true, branch };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		const msg = errMsg(e);
		if (OVERWRITE_RE.test(msg))
			return { ok: false, failure: 'dirty', files: parseBlockingFiles(msg).map((p) => resolve(root, p)), error: msg };
		if (/already exists/i.test(msg)) return { ok: false, failure: 'exists', error: msg };
		return { ok: false, error: msg };
	}
}

/**
 * Check out a local branch. Unsaved work git can carry over comes along, as it does in a
 * terminal; work the switch would overwrite stops it before anything changes. `git switch`
 * rather than checkout: it never reads its argument as a file.
 */
export function gitSwitch(workspaceRoot: string, name: string): Promise<GitSwitchResult> {
	return run(workspaceRoot, async (root) => {
		const known = (await git(root).raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n');
		return known.includes(name) ? ['switch', '--', name] : { ok: false, failure: 'missing' };
	});
}

/** start a branch from where HEAD is now, and switch to it: the unsaved work stays with it */
export function gitCreateBranch(workspaceRoot: string, name: string): Promise<GitSwitchResult> {
	return run(workspaceRoot, async (root) => ((await validName(root, name)) ? ['switch', '-c', name] : { ok: false, failure: 'invalid' }));
}

/** take up a branch that exists only on a remote: a local branch of the same name, tracking it */
export function gitTrackBranch(workspaceRoot: string, remoteName: string): Promise<GitSwitchResult> {
	return run(workspaceRoot, async (root) => {
		const known = (await git(root).raw(['for-each-ref', '--format=%(refname:short)', 'refs/remotes'])).split('\n');
		return known.includes(remoteName) && !remoteName.startsWith('-')
			? ['switch', '--track', remoteName]
			: { ok: false, failure: 'missing' };
	});
}

export type GitDeleteBranchResult = GitOpResult & {
	/** 'unmerged': it has versions no other branch has, and git keeps it (branch -d). 'current': the
	 *  branch checked out, or the one it syncs with. 'missing': no such branch. */
	failure?: 'unmerged' | 'current' | 'missing' | PushFailure;
	/** the remote a remote branch was deleted from */
	remote?: string;
};

function localNames(root: string): Promise<string[]> {
	return git(root)
		.raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
		.then((raw) => raw.split('\n').filter(Boolean));
}

/**
 * VS Code's Delete Branch: `git branch -d`, which keeps a branch whose versions are on no other
 * branch and says so ('unmerged'); `force` is the -D the author agreed to after that. Never the
 * branch checked out.
 */
export async function gitDeleteBranch(workspaceRoot: string, name: string, force = false): Promise<GitDeleteBranchResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	const g = git(root);
	try {
		if (name.startsWith('-') || !(await localNames(root)).includes(name)) return { ok: false, failure: 'missing' };
		// with -q, a detached HEAD prints nothing and exits 1, which simple-git resolves as ''
		if ((await g.raw(['symbolic-ref', '-q', '--short', 'HEAD'])).trim() === name) return { ok: false, failure: 'current' };
		await retryLocked(() => g.raw(['branch', force ? '-D' : '-d', name]));
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		const msg = errMsg(e);
		if (/not fully merged/i.test(msg)) return { ok: false, failure: 'unmerged', error: msg };
		return { ok: false, error: msg };
	}
}

/**
 * VS Code's Delete Remote Branch: `git push <remote> --delete <branch>`, for a branch the remote
 * has ('origin/camera-ready'). Never the one the current branch syncs with. Signs in like any
 * upload; the picker asks first, since everyone who syncs with that remote loses it too.
 */
export async function gitDeleteRemoteBranch(
	workspaceRoot: string,
	remoteName: string,
	auth: GitAuthEnv = {}
): Promise<GitDeleteBranchResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	const g = netGit(root, auth);
	let remote: string | undefined;
	try {
		const refs = (await g.raw(['for-each-ref', '--format=%(refname)', 'refs/remotes'])).split('\n');
		if (!refs.includes(`refs/remotes/${remoteName}`) || remoteName.endsWith('/HEAD')) return { ok: false, failure: 'missing' };
		// a remote's name can hold a slash too: the longest one that starts the ref is it
		const remotes = (await g.raw(['remote'])).split('\n').filter(Boolean);
		remote = remotes.filter((r) => remoteName.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
		if (!remote) return { ok: false, failure: 'missing' };
		const branch = remoteName.slice(remote.length + 1);
		const upstream = await g.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '');
		if (upstream.trim() === remoteName) return { ok: false, failure: 'current', remote };
		await g.raw(['push', remote, '--delete', `refs/heads/${branch}`]);
		return { ok: true, remote };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		const msg = errMsg(e);
		return { ok: false, failure: classifyPushError(msg), error: msg, remote };
	}
}
