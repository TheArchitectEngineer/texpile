// Milestones from History: a name on a version that matters, and taking it off again. Sync then
// carries them to the remote; removing one removes it there too (electron/src/gitTags.ts).
import { workspaceRoot } from './workspaceStore';
import { refreshGitHistory } from './gitStore';
import { gitMarkMilestone, gitRemoveMilestone, type GitTagResult } from './gitMilestones';
import { uploadReason } from './uploadReason';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';
import type { GitLogEntry } from './git';

function reason(res: GitTagResult): string {
	if (res.reason === 'no-git') return m.vcs_git_missing();
	if (res.failure === 'invalid') return m.vcs_milestone_invalid();
	if (res.failure === 'auth' || res.failure === 'network') return uploadReason({ failure: res.failure, error: res.error });
	return res.error || m.vcs_milestone_failed();
}

export class ScmMilestones {
	constructor(private host: { busy: boolean }) {}

	/** resolves to what went wrong, for the menu to show, or null once it is marked */
	mark = async (entry: GitLogEntry, label: string): Promise<string | null> => {
		const root = workspaceRoot.current;
		if (!root || this.host.busy) return '';
		const res = await gitMarkMilestone(root, entry.hash, label);
		if (!res.ok) return reason(res);
		await refreshGitHistory(root);
		toaster.success({ title: m.vcs_toast_milestone_marked({ name: label.trim() }) });
		return null;
	};

	remove = async (name: string, label: string): Promise<void> => {
		const root = workspaceRoot.current;
		if (!root || this.host.busy) return;
		this.host.busy = true;
		try {
			const res = await gitRemoveMilestone(root, name);
			if (!res.ok && res.failure !== 'cancelled') {
				toaster.error({ title: m.vcs_toast_milestone_remove_failed(), description: reason(res) });
				return;
			}
			if (res.ok) toaster.success({ title: m.vcs_toast_milestone_removed({ name: label }) });
			await refreshGitHistory(root);
		} finally {
			this.host.busy = false;
		}
	};
}
