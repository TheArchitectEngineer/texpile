// client half of electron/src/gitBranches.ts: the branch list and switching. Never throws.
import { nativeBridge } from './fileSystem';
import { NO_BRIDGE, errMsg, type PushFailure } from './git';

export type GitBranch = { name: string; upstream: string | null; date: string };
export type GitRemoteBranch = { name: string; remote: string; branch: string; date: string };

export type GitBranchesResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
	current?: string | null;
	local?: GitBranch[];
	remote?: GitRemoteBranch[];
};

export type GitSwitchResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
	failure?: 'dirty' | 'busy' | 'exists' | 'invalid' | 'missing';
	files?: string[];
	branch?: string;
};

/** what the panel's branch picker can do (ScmBranches); each resolves to why it did not happen,
 *  '' when the author backed out, or null once done */
export type BranchActions = {
	list: () => Promise<GitBranchesResult>;
	onSwitch: (name: string) => Promise<string | null>;
	onCreate: (name: string) => Promise<string | null>;
	onTrack: (remoteName: string) => Promise<string | null>;
	onDelete?: (name: string) => Promise<string | null>;
	onDeleteRemote?: (b: GitRemoteBranch) => Promise<string | null>;
};

/** Optional: an older preload predates it, and the branch name is only a label. */
export type GitBranchBridge = {
	gitBranches?: (root: string) => Promise<GitBranchesResult>;
	gitSwitch?: (root: string, name: string) => Promise<GitSwitchResult>;
	gitCreateBranch?: (root: string, name: string) => Promise<GitSwitchResult>;
	gitTrackBranch?: (root: string, remoteName: string) => Promise<GitSwitchResult>;
	gitDeleteBranch?: (root: string, name: string, force?: boolean) => Promise<GitDeleteBranchResult>;
	gitDeleteRemoteBranch?: (root: string, remoteName: string) => Promise<GitDeleteBranchResult>;
};

export type GitDeleteBranchResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
	/** 'unmerged': it has versions no other branch has. 'current': the branch checked out, or the one
	 *  it syncs with. The rest are an upload's (uploadReason.ts). */
	failure?: 'unmerged' | 'current' | 'missing' | PushFailure;
	remote?: string;
};

export function canSwitchBranch(): boolean {
	return !!nativeBridge()?.gitSwitch;
}

async function call<R extends { ok: boolean; error?: string }>(run: (() => Promise<R>) | null): Promise<R> {
	if (!run) return { ok: false, error: NO_BRIDGE } as R;
	try {
		return await run();
	} catch (e) {
		return { ok: false, error: errMsg(e) } as R;
	}
}

export function gitBranches(root: string): Promise<GitBranchesResult> {
	const n = nativeBridge();
	return call(n?.gitBranches ? () => n.gitBranches!(root) : null);
}

export function gitSwitch(root: string, name: string): Promise<GitSwitchResult> {
	const n = nativeBridge();
	return call(n?.gitSwitch ? () => n.gitSwitch!(root, name) : null);
}

export function gitCreateBranch(root: string, name: string): Promise<GitSwitchResult> {
	const n = nativeBridge();
	return call(n?.gitCreateBranch ? () => n.gitCreateBranch!(root, name) : null);
}

export function gitTrackBranch(root: string, remoteName: string): Promise<GitSwitchResult> {
	const n = nativeBridge();
	return call(n?.gitTrackBranch ? () => n.gitTrackBranch!(root, remoteName) : null);
}

export function gitDeleteBranch(root: string, name: string, force = false): Promise<GitDeleteBranchResult> {
	const n = nativeBridge();
	return call(n?.gitDeleteBranch ? () => n.gitDeleteBranch!(root, name, force) : null);
}

export function gitDeleteRemoteBranch(root: string, remoteName: string): Promise<GitDeleteBranchResult> {
	const n = nativeBridge();
	return call(n?.gitDeleteRemoteBranch ? () => n.gitDeleteRemoteBranch!(root, remoteName) : null);
}

/**
 * VS Code's sanitizeBranchName, with its default git.branchWhitespaceChar: a name typed the way a
 * writer would ("camera ready") becomes one git accepts ("camera-ready") instead of being refused.
 * Spaces and the characters git forbids in a ref become dashes; leading dashes go.
 */
export function branchNameFrom(typed: string): string {
	// nothing typed is no name (VS Code's rule would make it '-', which its input box then refuses)
	if (!typed.trim()) return '';
	return typed
		.trim()
		.replace(/^-+/, '')
		.replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$|\[|\]$/g, '-');
}
