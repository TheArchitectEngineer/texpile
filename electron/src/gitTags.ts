// Milestones: a name on a version that matters ("Sent to the committee", "Camera ready"), kept as
// an annotated git tag so every other tool sees it too. The name the author types is the tag's
// message; the tag itself gets a ref-safe form of it. The next upload of the branch carries one
// marked here (noted in PENDING_MILESTONES, gitRemote.ts), and removing one removes it there as
// well, or the next fetch would bring it straight back.
import { git, errMsg, isMissingGit, resolveRepoRoot, type GitOpResult } from './gitService';
import { classifyPushError, forgetPendingMilestones, netEnv, OWN_ENVIRONMENT, PENDING_MILESTONES, type GitAuthEnv } from './gitRemote';
import { simpleGit, type SimpleGit } from 'simple-git';

export type GitMilestone = {
	/** the tag's ref name: 'sent-to-the-committee' */
	name: string;
	/** what the author called it: 'Sent to the committee' */
	label: string;
};

export type GitTagResult = GitOpResult & { name?: string; failure?: 'invalid' | 'missing' | 'cancelled' | 'auth' | 'network' | 'other' };

const SEP = '\x1f';

/** exported for the tests: commit hash -> the milestones on it, from for-each-ref lines */
export function parseTags(raw: string): Record<string, GitMilestone[]> {
	const out: Record<string, GitMilestone[]> = {};
	for (const line of raw.split('\n')) {
		const [name, type, peeled, object, subject] = line.split(SEP);
		if (!name) continue;
		// an annotated tag points at a tag object, whose peeled target is the commit; a lightweight
		// one points at the commit itself and has no message of its own
		const annotated = type === 'tag';
		const commit = annotated ? peeled : object;
		if (!commit) continue;
		(out[commit] ??= []).push({ name, label: annotated && subject ? subject : name });
	}
	return out;
}

/** every milestone in the repository, by the commit it marks */
export async function milestonesByCommit(repoRoot: string): Promise<Record<string, GitMilestone[]>> {
	const raw = await git(repoRoot).raw([
		'for-each-ref',
		'--sort=-creatordate',
		// lstrip, not :short, which says "tags/main" when a branch is also called main
		`--format=%(refname:lstrip=2)${SEP}%(objecttype)${SEP}%(*objectname)${SEP}%(objectname)${SEP}%(contents:subject)`,
		'refs/tags'
	]);
	return parseTags(raw);
}

/** exported for the tests: a tag name from what the author typed, keeping letters in any script */
export function tagNameFor(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replace(/[\s~^:?*[\\]+/g, '-')
		.replace(/\.{2,}/g, '.')
		.replace(/@\{/g, '-')
		.replace(/[^\p{L}\p{N}._/-]+/gu, '')
		.replace(/-{2,}/g, '-')
		.replace(/^[-./]+|[-./]+$/g, '')
		.replace(/\.lock$/, '');
}

async function refFree(root: string, name: string): Promise<boolean> {
	if (!name || name.startsWith('-')) return false;
	try {
		await git(root).raw(['check-ref-format', `refs/tags/${name}`]);
	} catch {
		return false;
	}
	// nor a branch's name, here or on a remote: git would then refuse to upload that branch as
	// ambiguous, and read the milestone as "tags/<name>" everywhere
	const taken = new Set(
		(await git(root).raw(['for-each-ref', '--format=%(refname)', 'refs/tags', 'refs/heads', 'refs/remotes']))
			.split('\n')
			.map((r) => r.replace(/^refs\/(tags|heads)\//, '').replace(/^refs\/remotes\/[^/]+\//, ''))
	);
	return name !== 'HEAD' && !taken.has(name);
}

/** Mark a version as a milestone. Resolves to the tag's name, suffixed when the plain one is taken. */
export async function gitMarkMilestone(workspaceRoot: string, hash: string, label: string): Promise<GitTagResult> {
	const text = label.trim();
	if (!/^[0-9a-f]{4,64}$/i.test(hash) || !text || /[\n\r]/.test(text)) return { ok: false, failure: 'invalid' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	try {
		const base = tagNameFor(text) || `milestone-${hash.slice(0, 7)}`;
		let name = base;
		for (let i = 2; !(await refFree(root, name)); i++) {
			if (i > 50) return { ok: false, failure: 'invalid' };
			name = `${base}-${i}`;
		}
		await git(root).raw(['tag', '-a', name, '-m', text, hash]);
		// to go up with the next upload of a branch that has this version (gitRemote.ts)
		await git(root).raw(['config', '--add', PENDING_MILESTONES, name]);
		return { ok: true, name };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}

/** the remote the current branch syncs with, read from config; null without one */
async function syncRemote(root: string): Promise<string | null> {
	const branch = (await git(root).raw(['symbolic-ref', '-q', 'HEAD'])).trim().replace(/^refs\/heads\//, '');
	if (!branch) return null;
	return (await git(root).raw(['config', '--get', `branch.${branch}.remote`])).trim() || null;
}

/** whether the remote has the tag; null when it cannot be asked (offline, or not allowed to read) */
async function remoteHasTag(g: SimpleGit, remote: string, name: string): Promise<boolean | null> {
	try {
		return (await g.raw(['ls-remote', '--tags', '--refs', remote, `refs/tags/${name}`])).trim() !== '';
	} catch {
		return null;
	}
}

/**
 * Remove a milestone here and on the remote the branch syncs with: git fetches tags along with
 * the versions they mark, so one left there would come back with the next Sync. A remote that
 * never had it is not a failure.
 */
export async function gitRemoveMilestone(workspaceRoot: string, name: string, auth: GitAuthEnv = {}): Promise<GitTagResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	try {
		if (!name || name.startsWith('-') || (await git(root).raw(['tag', '--list', name])).trim() !== name)
			return { ok: false, failure: 'missing' };
		const remote = await syncRemote(root);
		if (remote) {
			const net = simpleGit({ baseDir: root, binary: 'git', maxConcurrentProcesses: 1, unsafe: OWN_ENVIRONMENT }).env(netEnv(auth));
			try {
				await net.raw(['push', remote, '--delete', `refs/tags/${name}`]);
			} catch (e) {
				const msg = errMsg(e);
				// refused (no write access, or offline) before git could say the remote never had it: ask
				// whether it does. One that was never uploaded is removed here all the same.
				if (!/remote ref does not exist/i.test(msg) && (await remoteHasTag(net, remote, name)) !== false) {
					const failure = classifyPushError(msg);
					return { ok: false, failure: failure === 'auth' || failure === 'network' ? failure : 'other', error: msg };
				}
			}
		}
		await git(root).raw(['tag', '-d', name]);
		await forgetPendingMilestones(git(root), [name]);
		return { ok: true, name };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}
