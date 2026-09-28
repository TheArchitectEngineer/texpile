// Branches for the command palette's Switch branch: the list of local branches and switching to
// one. VS Code's Git: Checkout to..., with the refusals said in words: git will not switch over
// unsaved work it would overwrite. Creating and deleting branches is left to git itself: Texpile
// cannot join two branches, so it does not start them.
import { git, patientGit, errMsg, isMissingGit, resolveRepoRoot, retryLocked, gitDirsOf, operationIn } from './gitService';
import type { GitOpResult } from './gitService';
import { OVERWRITE_RE, parseBlockingFiles } from './gitRemote';
import { resolve } from 'node:path';

export type GitBranch = {
	name: string;
	/** the remote branch it tracks, 'origin/main', or null */
	upstream: string | null;
	/** when the branch last had a version saved to it, ISO 8601 */
	date: string;
};

export type GitBranchesResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
	/** null when HEAD is a commit rather than a branch */
	current?: string | null;
	local?: GitBranch[];
};

export type GitSwitchResult = GitOpResult & {
	/** 'dirty': unsaved work the switch would overwrite. 'busy': a merge or rebase is under way.
	 *  'missing': no such branch. */
	failure?: 'dirty' | 'busy' | 'missing';
	/** what stood in the way of a 'dirty', absolute */
	files?: string[];
	/** the branch now checked out */
	branch?: string;
};

const SEP = '\x1f';

/** exported for the tests: for-each-ref lines of short name, upstream and date */
export function parseRefs(raw: string): GitBranch[] {
	const local: GitBranch[] = [];
	for (const line of raw.split('\n')) {
		const [short, upstream, date] = line.split(SEP);
		if (short) local.push({ name: short, upstream: upstream || null, date: date ?? '' });
	}
	return local;
}

export async function gitBranches(workspaceRoot: string): Promise<GitBranchesResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	try {
		const g = git(rr.root);
		const raw = await g.raw([
			'for-each-ref',
			'--sort=-committerdate',
			`--format=%(refname:lstrip=2)${SEP}%(upstream:lstrip=2)${SEP}%(committerdate:iso-strict)`,
			'refs/heads'
		]);
		// with -q, a detached HEAD prints nothing and exits 1, which simple-git resolves as ''
		const current = (await g.raw(['symbolic-ref', '-q', 'HEAD'])).trim().replace(/^refs\/heads\//, '') || null;
		return { ok: true, current, local: parseRefs(raw) };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/**
 * Check out a local branch. Unsaved work git can carry over comes along, as it does in a
 * terminal; work the switch would overwrite stops it before anything changes. `git switch`
 * rather than checkout: it never reads its argument as a file.
 */
export async function gitSwitch(workspaceRoot: string, name: string): Promise<GitSwitchResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	// patient (gitService.ts): a switch rewrites files through their filters, a Git LFS download
	// among them, and runs the post-checkout hook
	const g = patientGit(root);
	try {
		if (operationIn((await gitDirsOf(root)).gitDir)) return { ok: false, failure: 'busy' };
		const known = (await g.raw(['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads'])).split('\n');
		if (!known.includes(name)) return { ok: false, failure: 'missing' };
		await retryLocked(() => g.raw(['switch', '--', name]));
		const branch = (await g.raw(['symbolic-ref', '-q', 'HEAD'])).trim().replace(/^refs\/heads\//, '');
		return { ok: true, branch };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		const msg = errMsg(e);
		if (OVERWRITE_RE.test(msg))
			return { ok: false, failure: 'dirty', files: parseBlockingFiles(msg).map((p) => resolve(root, p)), error: msg };
		return { ok: false, error: msg };
	}
}
