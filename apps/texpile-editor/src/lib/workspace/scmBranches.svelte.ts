// Switching branches from the Source Control panel: VS Code's Checkout to..., Create Branch and
// the remote branches it offers to take up. The editor follows: the file tree is read again and
// the open file reloaded, since a switch rewrites files under both.
import { workspaceRoot } from './workspaceStore';
import { refreshGitStatus, refreshGitHistory, gitOperation, gitBranch } from './gitStore';
import { saveChangesFirst } from './scmSaveFirst';
import {
	gitBranches,
	gitSwitch,
	gitCreateBranch,
	gitTrackBranch,
	gitDeleteBranch,
	gitDeleteRemoteBranch,
	type GitBranchesResult,
	type GitDeleteBranchResult,
	type GitRemoteBranch,
	type GitSwitchResult
} from './gitBranches';
import { uploadReason } from './uploadReason';
import { confirmAsk } from '$lib/modals/confirm.svelte';
import { basename } from './fileSystem';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import type { ScmDeps } from './scmActions.svelte';

export type BranchHost = {
	busy: boolean;
	/** ScmActions.commit: Save version with these files and this message */
	commit(message: string, paths: string[]): Promise<boolean>;
};

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

/** what the picker says when a delete did not happen */
function deleteReason(res: GitDeleteBranchResult): string {
	if (res.reason === 'no-git') return m.vcs_git_missing();
	if (res.failure === 'current') return m.vcs_branch_delete_current();
	if (res.failure === 'missing') return m.vcs_branch_failed();
	// a remote branch's failure is an upload's: sign-in, network, a branch GitHub protects
	if (res.remote && res.failure !== 'unmerged') return uploadReason({ ...res, failure: res.failure });
	return res.error || m.vcs_branch_failed();
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

	/**
	 * VS Code's Delete Branch: at once when its versions are on another branch too, and after asking
	 * when they are not (it is "not fully merged"), since they go with it. Resolves as the picker's
	 * other actions do: why it did not happen, '' when the author backed out, null once deleted.
	 */
	remove = async (name: string): Promise<string | null> => {
		const root = workspaceRoot.current;
		if (!root || this.host.busy) return '';
		let res = await this.#busyWith(() => gitDeleteBranch(root, name));
		if (!res.ok && res.failure === 'unmerged') {
			if (!(await confirmAsk(m.vcs_branch_delete_unmerged({ name }), { confirmLabel: m.vcs_branch_delete(), danger: true }))) return '';
			res = await this.#busyWith(() => gitDeleteBranch(root, name, true));
		}
		if (!res.ok) return deleteReason(res);
		await refreshGitHistory(root); // its name came off the versions it marked
		toaster.success({ title: m.vcs_toast_branch_deleted({ name }) });
		return null;
	};

	/** VS Code's Delete Remote Branch, asked first here: everyone who syncs with the remote loses it */
	removeRemote = async (b: GitRemoteBranch): Promise<string | null> => {
		const root = workspaceRoot.current;
		if (!root || this.host.busy) return '';
		const ask = m.vcs_branch_delete_remote_confirm({ name: b.branch, remote: b.remote });
		if (!(await confirmAsk(ask, { confirmLabel: m.vcs_branch_delete(), danger: true }))) return '';
		const res = await this.#busyWith(() => gitDeleteRemoteBranch(root, b.name));
		if (!res.ok) return res.failure === 'cancelled' ? '' : deleteReason(res);
		await refreshGitHistory(root);
		toaster.success({ title: m.vcs_toast_remote_branch_deleted({ name: b.branch, remote: b.remote }) });
		return null;
	};

	async #busyWith<T>(run: () => Promise<T>): Promise<T> {
		this.host.busy = true;
		try {
			return await run();
		} finally {
			this.host.busy = false;
		}
	}

	/**
	 * The switch would overwrite changes not saved as a version: offer to save them on this branch
	 * first - every change the panel lists except build output, so what is left behind is not split
	 * between two branches. True once saved, and the switch is tried again.
	 */
	private saveFirst(name: string, blocking: string[]): Promise<boolean> {
		const host = {
			commit: (message: string, paths: string[]) => this.host.commit(message, paths),
			setBusy: (on: boolean) => (this.host.busy = on)
		};
		return saveChangesFirst(host, {
			title: m.vcs_branch_dirty_title(),
			message: m.vcs_branch_dirty_message({ files: blocking.map((f) => basename(f)).join(', '), branch: name }),
			detail: m.vcs_branch_dirty_detail({ branch: gitBranch.current ?? '' }),
			confirm: m.vcs_branch_save_and_switch(),
			version: m.vcs_branch_autosave_message({ branch: name })
		});
	}

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
			let res = await op(root);
			if (!res.ok && res.failure === 'dirty') {
				// VS Code offers to stash; a writer's word for keeping work safe is a version
				if (!(await this.saveFirst(name, res.files ?? []))) return '';
				res = await op(root);
			}
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
