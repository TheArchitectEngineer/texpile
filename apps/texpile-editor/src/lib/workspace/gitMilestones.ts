// client half of electron/src/gitTags.ts: naming a version, and taking the name off. Never throws.
import { nativeBridge } from './fileSystem';
import { NO_BRIDGE, errMsg } from './git';

export type GitTagResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git';
	error?: string;
	name?: string;
	failure?: 'invalid' | 'missing' | 'cancelled' | 'auth' | 'network' | 'other';
};

/** Optional: an older preload predates it, and History offers no milestones. */
export type GitMilestoneBridge = {
	gitMarkMilestone?: (root: string, hash: string, label: string) => Promise<GitTagResult>;
	gitRemoveMilestone?: (root: string, name: string) => Promise<GitTagResult>;
};

export function canMarkMilestones(): boolean {
	return !!nativeBridge()?.gitMarkMilestone;
}

export async function gitMarkMilestone(root: string, hash: string, label: string): Promise<GitTagResult> {
	const n = nativeBridge();
	if (!n?.gitMarkMilestone) return { ok: false, error: NO_BRIDGE };
	try {
		return await n.gitMarkMilestone(root, hash, label);
	} catch (e) {
		return { ok: false, error: errMsg(e) };
	}
}

export async function gitRemoveMilestone(root: string, name: string): Promise<GitTagResult> {
	const n = nativeBridge();
	if (!n?.gitRemoveMilestone) return { ok: false, error: NO_BRIDGE };
	try {
		return await n.gitRemoveMilestone(root, name);
	} catch (e) {
		return { ok: false, error: errMsg(e) };
	}
}
