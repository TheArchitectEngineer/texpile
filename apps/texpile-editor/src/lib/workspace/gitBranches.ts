// client half of electron/src/gitBranches.ts: the branch list and switching. Never throws.
import { nativeBridge } from './fileSystem';
import { NO_BRIDGE, errMsg } from './git';

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

/** Optional: an older preload predates it, and the branch name is only a label. */
export type GitBranchBridge = {
	gitBranches?: (root: string) => Promise<GitBranchesResult>;
	gitSwitch?: (root: string, name: string) => Promise<GitSwitchResult>;
	gitCreateBranch?: (root: string, name: string) => Promise<GitSwitchResult>;
	gitTrackBranch?: (root: string, remoteName: string) => Promise<GitSwitchResult>;
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
