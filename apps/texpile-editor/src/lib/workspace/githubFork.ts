// client half of electron/src/githubFork.ts: fork a GitHub repository the account may not write
// to, and publish the branch to the fork. Never throws.
import { nativeBridge } from './fileSystem';
import { NO_BRIDGE, errMsg, type PushFailure } from './git';

export type GithubForkResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	failure?: PushFailure | 'exists' | 'scope' | 'not-github';
	error?: string;
	remote?: string;
	url?: string;
	fullName?: string;
};

/** Optional: an older preload predates it, and a refused upload is only reported. */
export type GithubForkBridge = {
	githubFork?: (root: string, remote: string) => Promise<GithubForkResult>;
};

/** a GitHub repository's address, https or SSH: the only kind there is a fork to make of */
export function githubRepoOf(url: string): string | null {
	const m =
		/^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
			url.trim()
		);
	return m ? `${m[1]}/${m[2]}` : null;
}

export async function githubFork(root: string, remote: string): Promise<GithubForkResult> {
	const n = nativeBridge();
	if (!n?.githubFork) return { ok: false, error: NO_BRIDGE };
	try {
		return await n.githubFork(root, remote);
	} catch (e) {
		return { ok: false, failure: 'other', error: errMsg(e) };
	}
}
