// Publish to GitHub from a folder that is not a repository yet: VS Code's Publish to GitHub on a
// plain folder. Initialise, keep build output out, save everything else as a first version, and
// open the Publish dialog that a repository with a version gets. Each step stops the rest when it
// fails or is cancelled, having said why.
import { workspaceRoot } from './workspaceStore';
import { refreshGitStatus, gitChanges } from './gitStore';
import { gitInit } from './git';
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
		await this.scm.ignore.artifacts(true);
		await refreshGitStatus(root);
		const paths = gitChanges.current.filter((c) => !c.files && !isBuildArtifact(c.path)).map((c) => c.path);
		// an empty folder has nothing to save; Publish then says a version is needed first
		if (paths.length && !(await this.scm.commit(m.vcs_first_version_message(), paths))) return;
		await this.scm.publish();
	};
}
