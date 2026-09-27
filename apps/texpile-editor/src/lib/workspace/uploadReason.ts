// Why an upload, a publish or a sync did not happen, as a sentence someone can act on. git says
// "failed to push some refs" for most of these, which is true and useless: each case wants a
// different thing done, and only some of them are something Texpile could fix by trying again.
import type { SyncFailure } from './git';
import { m } from '$lib/paraglide/messages';

type Failed = { failure?: SyncFailure | 'exists' | 'scope'; error?: string; remote?: string; files?: string[] };

export function uploadReason(res: Failed): string {
	const remote = res.remote ?? '';
	const files = (res.files ?? []).join(', ');
	switch (res.failure) {
		case 'rejected':
			return m.vcs_sync_rejected({ remote });
		case 'auth':
			return m.vcs_upload_auth({ remote });
		case 'forbidden':
			return m.vcs_upload_forbidden({ remote });
		case 'secret': {
			const where = secretLocations(res.error ?? '').join(', ');
			return where ? m.vcs_upload_secret({ remote, where }) : m.vcs_upload_secret_nowhere({ remote });
		}
		case 'protected':
			return m.vcs_upload_protected({ remote });
		case 'network':
			return m.vcs_upload_network({ remote });
		case 'no-upstream':
			return m.vcs_upload_no_upstream();
		case 'conflict':
			return m.vcs_sync_conflict({ remote, files });
		case 'dirty':
			return files ? m.vcs_sync_dirty({ files }) : m.vcs_sync_dirty_nofiles();
		default:
			// an unclassified git failure: its own words beat a guess at what they meant
			return res.error ?? m.vcs_upload_unknown();
	}
}

/** the files and lines GitHub's push protection named ("path: chapters/data.tex:12"), once each */
export function secretLocations(output: string): string[] {
	return [...new Set([...output.matchAll(/^\s*(?:remote:)?\s*path:\s*(\S+)/gm)].map((x) => x[1]))];
}

/** the page GitHub gave for allowing a secret it flagged, when it gave one */
export function secretAllowUrl(output: string): string | null {
	return /https:\/\/github\.com\/\S+\/security\/secret-scanning\/unblock-secret\/\S+/.exec(output)?.[0] ?? null;
}
