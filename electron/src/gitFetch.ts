// Check for new versions: fetch the remote this branch syncs with and report how far behind it is,
// taking nothing in. For a co-author who wants to know whether someone uploaded before deciding to
// Sync; Refresh stays offline. VS Code's Fetch, without fetch-all, prune or a remote picker.
import { errMsg, isMissingGit, resolveRepoRoot } from './gitService';
import { aheadBehind, classifyPushError, netGit, upstreamOf, type GitAuthEnv, type PushFailure } from './gitRemote';

export type GitFetchResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	failure?: PushFailure;
	error?: string;
	remote?: string;
	/** versions there that are not here, and the other way round, as of this fetch */
	behind?: number;
	ahead?: number;
};

export async function gitFetch(workspaceRoot: string, auth: GitAuthEnv = {}): Promise<GitFetchResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const g = netGit(rr.root, auth);
	let remote: string | undefined;
	try {
		const status = await g.status();
		if (!status.current || status.detached || !status.tracking) return { ok: false, failure: 'no-upstream' };
		const up = await upstreamOf(g, status.current);
		if (!up) return { ok: false, failure: 'no-upstream' };
		remote = up.remote;
		await g.fetch(up.remote);
		const [ahead, behind] = await aheadBehind(g);
		return { ok: true, remote, ahead, behind };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		const msg = errMsg(e);
		return { ok: false, failure: classifyPushError(msg), error: msg, remote };
	}
}
