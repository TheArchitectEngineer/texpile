// Publish to GitHub from a folder that is not a repository yet: VS Code's Publish to GitHub on a
// plain folder. Initialise, keep build output out, save everything else as a first version, and
// open the Publish dialog that a repository with a version gets. Each step stops the rest when it
// fails or is cancelled, having said why.
import { workspaceRoot } from './workspaceStore';
import { refreshGitStatus, gitChanges } from './gitStore';
import { gitInit } from './git';
import { askPublishFiles } from './gitDialogs.svelte';
import { joinPath, relativeTo } from './fileSystem';
import { isBuildArtifact } from './buildArtifacts';
import { localGitReason } from './gitLocalReason';
import { toastGitFailure } from './gitFailureToast';
import type { ScmActions } from './scmActions.svelte';
import { m } from '$lib/paraglide/messages';

export class ScmPublishNew {
	constructor(private scm: ScmActions) {}

	run = async (): Promise<void> => {
		const root = workspaceRoot.current;
		if (!root || this.scm.busy) return;
		this.scm.busy = true;
		const made = await gitInit(root);
		this.scm.busy = false;
		if (!made.ok) {
			const why = made.reason === 'no-git' ? m.vcs_git_missing() : localGitReason(made.error);
			toastGitFailure(m.wsview_toast_git_init_failed_title(), why, made);
			return;
		}
		// VS Code asks which files go in when the folder has no .gitignore; asked here after build
		// output is left out, so the list is what would really be published
		const asking = !(await this.scm.ignore.exists());
		await this.scm.ignore.artifacts(true);
		await refreshGitStatus(root);
		if (asking && !(await this.#leaveOut(root))) return;
		const paths = gitChanges.current.filter((c) => !c.files && !isBuildArtifact(c.path)).map((c) => c.path);
		// an empty folder has nothing to save; Publish then says so, before any repository is made
		if (paths.length && !(await this.scm.commit(m.vcs_first_version_message(), paths))) return;
		await this.scm.publish();
	};

	/** VS Code's "Select which files should be included in the repository": the top level, all
	 *  ticked; what is unticked goes into .gitignore. False when the author backs out. */
	async #leaveOut(root: string): Promise<boolean> {
		const top = new Map<string, boolean>();
		for (const c of gitChanges.current) {
			if (isBuildArtifact(c.path)) continue;
			const [name, ...rest] = relativeTo(root, c.path).split(/[\\/]/);
			// .gitignore is what records the choice, so it is not one of them
			if (name && name !== '.gitignore') top.set(name, (top.get(name) ?? false) || rest.length > 0 || !!c.files);
		}
		if (!top.size) return true;
		const entries = [...top].map(([name, folder]) => ({ name, folder })).sort((a, b) => a.name.localeCompare(b.name));
		const kept = await askPublishFiles({ entries });
		if (!kept?.length) return false;
		// a folder's path ends in a slash, and so does its line (ScmIgnore.files)
		const out = entries.filter((e) => !kept.includes(e.name)).map((e) => joinPath(root, e.name) + (e.folder ? '/' : ''));
		if (out.length) await this.scm.ignore.files(out, true);
		return true;
	}
}
