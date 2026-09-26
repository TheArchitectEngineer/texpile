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
