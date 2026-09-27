// client half of electron/src/gitClone.ts: cloning a project from its address. Never throws.
import { nativeBridge } from './fileSystem';
import { NO_BRIDGE, errMsg } from './git';

export type CloneFailure = 'exists' | 'not-found' | 'invalid' | 'auth' | 'network' | 'cancelled' | 'other';

export type GitCloneResult = {
	ok: boolean;
	reason?: 'no-git';
	failure?: CloneFailure;
	error?: string;
	/** the new folder, absolute */
	path?: string;
};

/** git's stage ('receiving', 'resolving', ...) and how far through it */
export type CloneProgress = { stage: string; percent: number };

/** Optional: an older preload predates it, and nothing offers to clone. */
export type GitCloneBridge = {
	gitClone?: (url: string, parent: string, name: string) => Promise<GitCloneResult>;
	onGitCloneProgress?: (cb: (p: CloneProgress) => void) => () => void;
	gitCancelClone?: () => Promise<boolean>;
};

export function canClone(): boolean {
	return !!nativeBridge()?.gitClone;
}

/** clone `url` into `<parent>/<name>`, reporting progress while it downloads */
export async function gitClone(
	url: string,
	parent: string,
	name: string,
	onProgress?: (p: CloneProgress) => void
): Promise<GitCloneResult> {
	const n = nativeBridge();
	if (!n?.gitClone) return { ok: false, error: NO_BRIDGE };
	// called across the context bridge, which clones whatever the callback returns: returning a
	// Svelte state proxy (as `(p) => (step = p)` does) throws on every update
	const off = onProgress
		? n.onGitCloneProgress?.((p) => {
				onProgress(p);
			})
		: undefined;
	try {
		return await n.gitClone(url, parent, name);
	} catch (e) {
		return { ok: false, failure: 'other', error: errMsg(e) };
	} finally {
		off?.();
	}
}

/** stop this window's clone; it then fails as 'cancelled', and git removes what it downloaded */
export function cancelClone(): void {
	void nativeBridge()?.gitCancelClone?.();
}
