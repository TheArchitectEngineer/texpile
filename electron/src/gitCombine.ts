// Combining two lines of work in the app rather than in a terminal. Sync backs a merge out the
// moment both sides changed the same lines, so the project is never left half-combined behind the
// author's back; this is the step they choose instead: start that merge and leave each such place
// marked in its file, then finish it once every place is chosen, or cancel it.
import { resolve } from 'node:path';
import {
	git,
	errMsg,
	isMissingGit,
	isUnmerged,
	resolveRepoRoot,
	retryLocked,
	gitDirsOf,
	operationIn,
	stillMarked,
	toRepoRel,
	wholeFileChoice,
	type GitOpResult
} from './gitService';
import { OVERWRITE_RE, aheadBehind, mergeInProgress, outputOf, parseBlockingFiles } from './gitRemote';

export type GitCombineResult = GitOpResult & {
	/** 'busy': a merge, rebase or cherry-pick is already under way. 'dirty': work not saved as a
	 *  version is in the way. 'markers': a file still holds a place nobody has chosen for.
	 *  'not-combining': there is no merge to finish. */
	failure?: 'no-upstream' | 'busy' | 'dirty' | 'markers' | 'not-combining';
	/** what this branch is being combined with, as git names it: 'origin/main' */
	with?: string;
	/** the files both sides changed, left marked for someone to choose; absolute. Empty when
	 *  git could join the two on its own, which finishes the merge there and then. */
	conflicts?: string[];
	/** what stood in the way of a 'dirty' or a 'markers'; absolute */
	files?: string[];
};

function absolute(root: string, paths: string[]): string[] {
	return paths.map((p) => resolve(root, p));
}

/**
 * Merge the upstream into this branch and leave whatever git cannot join marked in the files.
 * What Sync fetched a moment ago is what it merges: this is the answer to Sync's conflict, never a
 * fetch of its own. Only from a clean tree, so Cancel can always put everything back.
 */
export async function gitCombine(workspaceRoot: string): Promise<GitCombineResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	const g = git(root);
	try {
		if (operationIn((await gitDirsOf(root)).gitDir)) return { ok: false, failure: 'busy' };
		const status = await g.status(['--untracked-files=no']);
		if (!status.current || status.detached || !status.tracking) return { ok: false, failure: 'no-upstream' };
		const dirty = status.files.map((f) => f.path);
		if (dirty.length) return { ok: false, failure: 'dirty', files: absolute(root, dirty) };

		// by the upstream's own name rather than @{u}: git writes what it was given into every marked
		// place, and "Their version · @{u}" means nothing to the person choosing.
		// A conflict exits 1 with its report on stdout, which simple-git resolves rather than throws.
		const tracking = status.tracking;
		const msg = await outputOf(retryLocked(() => g.raw(['merge', '--no-edit', tracking])));
		if (await mergeInProgress(g)) return { ok: true, with: status.tracking, conflicts: absolute(root, (await g.status()).conflicted) };
		if (OVERWRITE_RE.test(msg)) return { ok: false, failure: 'dirty', files: absolute(root, parseBlockingFiles(msg)) };
		const [, behind] = await aheadBehind(g);
		return behind === 0
			? { ok: true, with: status.tracking, conflicts: [] }
			: { ok: false, error: msg || 'git did not join the two histories' };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/**
 * Save the merge as a version: mark every file both sides changed as settled and commit with the
 * message git prepared. Refused while any of those files still holds a marked place, which is how
 * a file full of <<<<<<< lines never gets saved as though it were the combined text.
 */
export async function gitFinishCombine(workspaceRoot: string): Promise<GitCombineResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	const g = git(root);
	try {
		if (!(await mergeInProgress(g))) return { ok: false, failure: 'not-combining' };
		const conflicted = (await g.status()).files.filter((f) => isUnmerged(f.index, f.working_dir));
		const unmerged = conflicted.map((f) => f.path);
		const marked: string[] = [];
		for (const f of conflicted) {
			const abs = resolve(root, f.path);
			// a place still marked, or a whole file nobody has chosen a side of yet
			if ((await wholeFileChoice(f.index, f.working_dir, abs)) || (await stillMarked(abs))) marked.push(abs);
		}
		if (marked.length) return { ok: false, failure: 'markers', files: marked };
		// -A: a file one side deleted is settled by its absence as much as by its presence
		if (unmerged.length) await retryLocked(() => g.raw(['add', '-A', '--', ...unmerged]));
		await retryLocked(() => g.raw(['commit', '--no-edit']));
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/** Put everything back as it was before the merge started. Nothing to cancel is not a failure. */
export async function gitCancelCombine(workspaceRoot: string): Promise<GitOpResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const g = git(rr.root);
	try {
		if (await mergeInProgress(g)) await retryLocked(() => g.raw(['merge', '--abort']));
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/**
 * One side's whole file, for a file both sides changed: Keep all mine or theirs, from the file's
 * row. For a figure or a PDF there are no places to click, and when one side deleted the file there
 * is no text at all; keeping that side then keeps it deleted. The file stays in the merge, ready,
 * and Finish combining records it with the rest.
 */
export async function gitKeepSide(workspaceRoot: string, path: string, side: 'mine' | 'theirs'): Promise<GitOpResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const g = git(rr.root);
	const [rel] = toRepoRel(rr.root, [path]);
	if (!rel || rel.startsWith('..') || (side !== 'mine' && side !== 'theirs')) return { ok: false, error: 'Not a file in this repository' };
	try {
		if (!(await mergeInProgress(g))) return { ok: false, error: 'Nothing is being combined' };
		const f = (await g.status()).files.find((e) => e.path === rel && isUnmerged(e.index, e.working_dir));
		if (!f) return { ok: false, error: 'This file is not being combined' };
		const whole = await wholeFileChoice(f.index, f.working_dir, resolve(rr.root, rel));
		try {
			await retryLocked(() => g.raw(['checkout', side === 'mine' ? '--ours' : '--theirs', '--', rel]));
			// nothing in a figure or a kept file shows the choice was made: recording it is what does,
			// as VS Code's Keep Our Version stages it (a deletion is recorded by the rm below)
			if (whole) await retryLocked(() => g.raw(['add', '--', rel]));
		} catch (e) {
			if (!/does not have (our|their) version/i.test(errMsg(e))) throw e;
			await retryLocked(() => g.raw(['rm', '-q', '--', rel]));
		}
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}
