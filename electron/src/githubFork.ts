// Uploading where the account may not write: VS Code's "Create Fork" offer. Make the author's own
// copy of the GitHub repository, add it as a remote named after their account, and publish the
// branch there, so the project then syncs with the fork. Signed in the way githubPublish.ts is.
import { net, type WebContents } from 'electron';
import { helperCall } from './helper/helperProcess';
import { withAskpass } from './gitAskpass';
import { forkGithubRepo, parseGithubRepo, type GithubFailure } from './github';
import type { GitOpResult } from './gitService';
import type { GitCredentialResult, GitPushResult, GitRemotesResult, PushFailure } from './gitRemote';

export type GithubForkPublishResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git';
	/** 'not-github': the remote is not a GitHub repository, so there is nothing to fork */
	failure?: GithubFailure | PushFailure | 'not-github';
	error?: string;
	/** the fork's remote, which the branch now tracks */
	remote?: string;
	url?: string;
	fullName?: string;
};

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** the same GitHub repository, whichever address form each is written in */
function sameRepo(a: string, b: string): boolean {
	const x = parseGithubRepo(a);
	const y = parseGithubRepo(b);
	return !!x && !!y && x.owner.toLowerCase() === y.owner.toLowerCase() && x.repo.toLowerCase() === y.repo.toLowerCase();
}

/** a push that arrived before GitHub finished making the fork */
const NOT_YET_RE = /repository not found|not found|does not exist|could not read from remote/i;

function freeName(taken: string[], preferred: string[]): string {
	const free = preferred.find((n) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n) && !taken.includes(n));
	if (free) return free;
	let i = 2;
	while (taken.includes(`fork${i}`)) i++;
	return `fork${i}`;
}

export function githubFork(sender: WebContents, root: string, remote: string): Promise<GithubForkPublishResult> {
	return withAskpass(sender, async (env): Promise<GithubForkPublishResult> => {
		const listed = (await helperCall('git.gitRemotes', [root])) as GitRemotesResult;
		const remotes = listed.remotes ?? [];
		const source = remotes.find((r) => r.name === remote);
		const repo = source ? parseGithubRepo(source.url) : null;
		if (!repo) return { ok: false, failure: 'not-github' };

		const cred = (await helperCall('git.gitCredentialFill', [root, 'github.com', env])) as GitCredentialResult;
		if (!cred.ok || !cred.credential) return { ok: false, reason: cred.reason, failure: 'auth', error: cred.error };
		const forked = await forkGithubRepo((url, init) => net.fetch(url, init), cred.credential.password, repo.owner, repo.repo);
		if (!forked.ok) {
			if (forked.failure === 'auth') await helperCall('git.gitCredentialVerdict', [root, cred.credential, false]);
			return { ok: false, failure: forked.failure, error: forked.error };
		}
		await helperCall('git.gitCredentialVerdict', [root, cred.credential, true]);
		const { fullName, htmlUrl, cloneUrl, owner } = forked.repo;

		// a remote that already points at the fork is reused; otherwise one named after the account
		let name = remotes.find((r) => sameRepo(r.url, cloneUrl))?.name;
		if (!name) {
			name = freeName(
				remotes.map((r) => r.name),
				[owner, 'fork']
			);
			const added = (await helperCall('git.gitAddRemote', [root, name, cloneUrl])) as GitOpResult;
			if (!added.ok) return { ok: false, reason: added.reason, failure: 'other', error: added.error, url: htmlUrl, fullName };
		}

		// GitHub makes the copy in the background; a few seconds is usual, a large repository longer
		let pushed = (await helperCall('git.gitPublish', [root, name, env])) as GitPushResult;
		for (let wait = 2000; !pushed.ok && NOT_YET_RE.test(pushed.error ?? '') && wait <= 16000; wait *= 2) {
			await sleep(wait);
			pushed = (await helperCall('git.gitPublish', [root, name, env])) as GitPushResult;
		}
		return { ...pushed, remote: name, url: htmlUrl, fullName };
	});
}
