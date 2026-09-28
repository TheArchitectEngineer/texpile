// What the author has chosen in the Source Control panel but not saved yet: the files they
// unticked, the build output they ticked, and the message they typed.
//
// This lived inside the panel, and the panel only exists while the sidebar shows it. Switching to
// the file tree and back therefore ticked everything again and emptied the message, so the next
// Save version quietly took in files the author had deliberately left out. Kept here, per folder,
// it lasts as long as the window does.
import { isBuildArtifact } from './buildArtifacts';
import type { GitStatusEntry } from './git';

/** build output and whole folders of new files start unticked: ticking one is an opt-in */
export function optIn(c: GitStatusEntry): boolean {
	return !!c.files || isBuildArtifact(c.path);
}

export class ScmDraft {
	/** Paths the author has UNticked. Exclusions rather than inclusions, so a file that changes
	 *  while the panel is open joins the next version by default instead of being left out. */
	excluded = $state<string[]>([]);
	/** Build output starts unticked without being "excluded by the author": ticking one is
	 *  remembered rather than undone on the next scan. */
	artifactsOptedIn = $state<string[]>([]);
	message = $state('');

	/** ticked in the panel. Commit & Sync and Commit & Checkout go by it too (scmSaveFirst.ts), so
	 *  a file unstaged to stay on this computer is not committed and pushed behind the author's back */
	ticked(c: GitStatusEntry): boolean {
		return optIn(c) ? this.artifactsOptedIn.includes(c.path) : !this.excluded.includes(c.path);
	}

	/** After a commit: the message is spent. What was left unstaged stays so, as in VS Code; given
	 *  the changes listed now, a file that has left the list is forgotten, and starts over when it
	 *  next changes. Emptying the exclusions here staged a private draft again for the next commit. */
	clear(listed?: string[]): void {
		this.message = '';
		if (!listed) return;
		this.excluded = this.excluded.filter((p) => listed.includes(p));
		this.artifactsOptedIn = this.artifactsOptedIn.filter((p) => listed.includes(p));
	}
}

const drafts = new Map<string, ScmDraft>();

/** the draft for one folder; a window that opens another folder starts that one fresh */
export function scmDraftFor(root: string): ScmDraft {
	let draft = drafts.get(root);
	if (!draft) {
		draft = new ScmDraft();
		drafts.set(root, draft);
	}
	return draft;
}
