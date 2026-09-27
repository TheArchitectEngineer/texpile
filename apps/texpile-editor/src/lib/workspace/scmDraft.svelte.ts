// What the author has chosen in the Source Control panel but not saved yet: the files they
// unticked, the build output they ticked, and the message they typed.
//
// This lived inside the panel, and the panel only exists while the sidebar shows it. Switching to
// the file tree and back therefore ticked everything again and emptied the message, so the next
// Save version quietly took in files the author had deliberately left out. Kept here, per folder,
// it lasts as long as the window does.

export class ScmDraft {
	/** Paths the author has UNticked. Exclusions rather than inclusions, so a file that changes
	 *  while the panel is open joins the next version by default instead of being left out. */
	excluded = $state<string[]>([]);
	/** Build output starts unticked without being "excluded by the author": ticking one is
	 *  remembered rather than undone on the next scan. */
	artifactsOptedIn = $state<string[]>([]);
	message = $state('');

	/** after a version is saved: what was chosen for it is spent */
	clear(): void {
		this.excluded = [];
		this.artifactsOptedIn = [];
		this.message = '';
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
