// What a version that joins this branch with its remote is called. Git's own is "Merge
// remote-tracking branch 'origin/main'", which is all git words; Texpile makes that version itself
// (Sync, Combine now), so it names it as a writer would: "Joined with the versions on GitHub".
import { gitRemotes } from './git';
import { m } from '$lib/paraglide/messages';

/** the hosts people know by name */
const KNOWN: Record<string, string> = {
	'github.com': 'GitHub',
	'gitlab.com': 'GitLab',
	'bitbucket.org': 'Bitbucket',
	'codeberg.org': 'Codeberg'
};

/** exported for the tests: where a remote is, as a person would say it. The host of an https or
 *  SSH address, by its name when it is a well-known one; a folder or anything else by the
 *  remote's own name. */
export function remotePlace(url: string | undefined, remote: string): string {
	const u = (url ?? '').trim();
	const host =
		/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(u)?.[1] ??
		// scp-like: git@github.com:owner/repo.git
		/^(?:[^@/\s]+@)?([^/:\s]+\.[^/:\s]+):(?!\/)/.exec(u)?.[1];
	if (!host) return remote;
	return KNOWN[host.toLowerCase()] ?? host.toLowerCase();
}

/** the remote a tracking ref belongs to: the longest remote name that starts 'origin/main' */
export function remoteOf(tracking: string, remotes: string[]): string | null {
	return remotes.filter((r) => tracking.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/** the message, or '' (git's own) when where the branch syncs to cannot be read */
export async function joinedMessage(root: string, tracking: string | null): Promise<string> {
	if (!tracking) return '';
	const listed = await gitRemotes(root);
	const remotes = listed.remotes ?? [];
	const name = remoteOf(
		tracking,
		remotes.map((r) => r.name)
	);
	if (!name) return '';
	return m.vcs_joined_message({ place: remotePlace(remotes.find((r) => r.name === name)?.url, name) });
}
