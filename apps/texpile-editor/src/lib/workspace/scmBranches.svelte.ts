// Switching branches from the Source Control panel: VS Code's Checkout to..., Create Branch and
// the remote branches it offers to take up. The editor follows: the file tree is read again and
// the open file reloaded, since a switch rewrites files under both.
import { workspaceRoot } from './workspaceStore';
import { refreshGitStatus, refreshGitHistory, gitOperation } from './gitStore';
import { gitBranches, gitSwitch, gitCreateBranch, gitTrackBranch, type GitBranchesResult, type GitSwitchResult } from './gitBranches';
import { basename } from './fileSystem';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import type { ScmDeps } from './scmActions.svelte';

export type BranchHost = { busy: boolean };

/** exported for the tests: what the picker says when a switch did not happen */
export function switchReason(res: GitSwitchResult, name: string): string {
	if (res.reason === 'no-git') return m.vcs_git_missing();
	switch (res.failure) {
		case 'dirty':
			return m.vcs_branch_dirty({ files: (res.files ?? []).map((f) => basename(f)).join(', ') });
		case 'busy':
			return m.vcs_toast_finish_first();
		case 'exists':
			return m.vcs_branch_exists({ name });
		case 'invalid':
			return m.vcs_branch_invalid();
		default:
			return res.error || m.vcs_branch_failed();
	}
}

export class ScmBranches {
	constructor(
		private host: BranchHost,
		private deps: ScmDeps
	) {}

	list = async (): Promise<GitBranchesResult> => {
		const root = workspaceRoot.current;
		return root ? gitBranches(root) : { ok: false };
	};

	/** each resolves to the reason it did not happen, for the picker to show, or null once switched */
	switchTo = (name: string): Promise<string | null> => this.change(name, (root) => gitSwitch(root, name), m.vcs_toast_switched);
	create = (name: string): Promise<string | null> => this.change(name, (root) => gitCreateBranch(root, name), m.vcs_toast_branch_created);
	track = (remoteName: string): Promise<string | null> =>
		this.change(remoteName, (root) => gitTrackBranch(root, remoteName), m.vcs_toast_switched);

	private async change(
		name: string,
		op: (root: string) => Promise<GitSwitchResult>,
		done: (a: { branch: string }) => string
	): Promise<string | null> {
		const root = workspaceRoot.current;
		if (!root || this.host.busy) return '';
		if (gitOperation.current) return m.vcs_toast_finish_first();
		this.host.busy = true;
		try {
			// on disk first: git can then refuse to overwrite the edit, instead of the edit landing on
			// the other branch's copy of the file after the switch
			if (this.deps.hasPendingSave()) await this.deps.flushPendingSave();
			const res = await op(root);
			if (!res.ok) return switchReason(res, name);
			const loaded = this.deps.getLoadedPath();
			await this.deps.refreshTree();
			// a file the other branch does not have is left to the editor's own "deleted on disk" state
			if (loaded && (await this.deps.readTextIfPresent(loaded)) !== null) await this.deps.loadFile(loaded);
			if (this.deps.isDiffMode()) this.deps.captureDiffSnapshot();
			await refreshGitStatus(root);
			await refreshGitHistory(root);
			toaster.success({ title: done({ branch: res.branch || name }) });
			return null;
		} finally {
			this.host.busy = false;
		}
	}
}
