// client half of gitChangesIn / gitFileAt (electron/src/gitHistory.ts): what one version changed,
// and each file on either side of it. Never throws.
import { nativeBridge } from './fileSystem';
import { NO_BRIDGE, errMsg, type GitFileChange, type GitShowResult } from './git';

export type GitVersionChangesResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git';
	error?: string;
	entries?: GitFileChange[];
	/** the version it is compared with; null for a project's first version */
	parent?: string | null;
};

/** Optional: an older preload predates it, and History offers no per-version view. */
export type GitVersionBridge = {
	gitChangesIn?: (root: string, hash: string) => Promise<GitVersionChangesResult>;
	gitFileAt?: (root: string, path: string, ref: string) => Promise<GitShowResult>;
};

export function canShowVersion(): boolean {
	return !!nativeBridge()?.gitChangesIn;
}

export async function gitChangesIn(root: string, hash: string): Promise<GitVersionChangesResult> {
	const n = nativeBridge();
	if (!n?.gitChangesIn) return { ok: false, error: NO_BRIDGE };
	try {
		return await n.gitChangesIn(root, hash);
	} catch (e) {
		return { ok: false, error: errMsg(e) };
	}
}

/** the file's text at `ref`; '' where it did not exist */
export async function gitFileAt(root: string, path: string, ref: string): Promise<GitShowResult> {
	const n = nativeBridge();
	if (!n?.gitFileAt) return { ok: false, hasHead: false, error: NO_BRIDGE };
	try {
		return await n.gitFileAt(root, path, ref);
	} catch (e) {
		return { ok: false, hasHead: false, error: errMsg(e) };
	}
}
