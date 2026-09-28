// A refused upload to someone else's GitHub repository: VS Code's "You don't have permissions to
// push... create a fork?", in plainer words. The author's versions are unchanged either way; with
// a fork the project syncs with their own copy from then on.
import { refreshGitStatus } from './gitStore';
import { gitRemotes } from './git';
import { githubFork, githubRepoOf } from './githubFork';
import { uploadReason } from './uploadReason';
import { promptAsk } from '$lib/modals/confirm.svelte';
import { toaster } from '$lib/modals/toaster-svelte';
import { toastGitFailure } from './gitFailureToast';
import { m } from '$lib/paraglide/messages';

/**
 * Offer a fork for an upload `remote` refused. Resolves true when the offer was made - taken up or
 * not, the author has had their answer - and false when there is nothing to offer (not GitHub), so
 * the caller reports the refusal as it would have.
 */
export async function offerFork(root: string, remote: string | undefined): Promise<boolean> {
	if (!remote) return false;
	const listed = await gitRemotes(root);
	const url = listed.remotes?.find((r) => r.name === remote)?.url;
	const repo = url ? githubRepoOf(url) : null;
	if (!repo) return false;

	const choice = await promptAsk({
		title: m.vcs_fork_title(),
		message: m.vcs_fork_message({ repo }),
		detail: m.vcs_fork_detail(),
		buttons: [
			{ id: 'fork', label: m.vcs_fork_confirm(), primary: true },
			{ id: 'cancel', label: m.vcs_cancel() }
		],
		cancelId: 'cancel'
	});
	if (choice !== 'fork') return true;

	const res = await githubFork(root, remote);
	await refreshGitStatus(root);
	if (res.ok) {
		const link = res.url;
		toaster.success({
			title: m.vcs_toast_forked({ name: res.fullName ?? '' }),
			action: link ? { label: m.vcs_open_on_github(), onClick: () => void window.open(link, '_blank') } : undefined
		});
	} else if (res.failure !== 'cancelled') {
		const description =
			res.failure === 'scope'
				? m.vcs_fork_scope()
				: res.failure === 'auth'
					? m.vcs_publish_github_auth()
					: uploadReason({ error: res.error, remote: 'GitHub', failure: res.failure === 'network' ? 'network' : 'other' });
		toastGitFailure(m.vcs_toast_fork_failed(), description, res);
	}
	return true;
}
