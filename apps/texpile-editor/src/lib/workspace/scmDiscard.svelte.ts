// Throwing changes away from the Source Control list. Tracked files go back to the last version;
// a file that was never saved as a version goes to the Trash, not away for good: a new chapter is
// the one thing in this panel git cannot give back. Where there is no Trash (some Linux desktops,
// network shares) the author is asked before anything is deleted outright, as VS Code asks.
import { workspaceRoot } from './workspaceStore';
import { refreshGitStatus, isNewFile } from './gitStore';
import { gitDiscard, gitUnstage, type GitStatusEntry } from './git';
import { toastGitFailure } from './gitFailureToast';
import { localGitReason } from './gitLocalReason';
import { basename, relativeInside, samePath } from './fileSystem';
import { confirmAsk } from '$lib/modals/confirm.svelte';
import { m } from '$lib/paraglide/messages';
import type { ScmDeps } from './scmActions.svelte';

type DiscardDeps = Pick<
	ScmDeps,
	'getLoadedPath' | 'discardPendingSave' | 'trashEntry' | 'removeEntry' | 'refreshTree' | 'loadFile' | 'isDiffMode' | 'captureDiffSnapshot'
>;

/** VS Code's question: what is about to happen, and under it what follows from it */
function question(changes: GitStatusEntry[], allNew: boolean): { message: string; detail: string } {
	const one = changes.length === 1;
	const name = basename(changes[0].path);
	if (allNew)
		return one
			? { message: m.vcs_confirm_trash_one({ name }), detail: m.vcs_confirm_trash_one_detail() }
			: { message: m.vcs_confirm_trash_other({ count: changes.length }), detail: m.vcs_confirm_trash_other_detail() };
	return {
		message: one ? m.wsview_confirm_discard_one({ name }) : m.wsview_confirm_discard_other({ count: changes.length }),
		detail: m.history_irreversible()
	};
}

export class ScmDiscard {
	constructor(
		private host: { busy: boolean },
		private deps: DiscardDeps
	) {}

	run = async (asked: GitStatusEntry[]): Promise<void> => {
		const root = workspaceRoot.current;
		// a folder that also holds ignored files is never deleted whole: that would take them too
		const changes = asked.filter((c) => !c.ignoredInside);
		// never in the middle of a save or a sync: the files it is about to put back are in flight
		if (!root || !changes.length || this.host.busy) return;
		// the question says which of the two will happen
		const allNew = changes.every(isNewFile);
		const confirmLabel = allNew ? m.vcs_move_to_trash() : m.vcs_discard_changes();
		const ask = question(changes, allNew);
		if (!(await confirmAsk(ask.message, { detail: ask.detail, confirmLabel, danger: true }))) return;
		// if the open file is being discarded, drop its queued autosave first: otherwise a debounced
		// write scheduled just before the confirm lands after git reverts and re-creates the changes
		const loadedPath = this.deps.getLoadedPath();
		// samePath: git and the file tree hand back separators and case that do not always match, and
		// a miss here leaves the editor showing content that is no longer on disk
		// A folder row (a big new folder, shown as one) takes the open file with it when it is inside
		const openAffected =
			!!loadedPath && changes.some((c) => samePath(c.path, loadedPath) || (!!c.files && !!relativeInside(c.path, loadedPath)));
		if (openAffected) this.deps.discardPendingSave();
		this.host.busy = true;
		let err: string | undefined;
		try {
			err = await this.#throwAway(root, changes);
		} finally {
			this.host.busy = false;
		}
		if (err) toastGitFailure(m.wsview_toast_discard_failed_title(), localGitReason(err), { error: err });
		await this.deps.refreshTree();
		await refreshGitStatus(root);
		if (openAffected && loadedPath) await this.deps.loadFile(loadedPath); // its on-disk content changed
		// an open comparison was computed against the changes just thrown away, and went on showing
		// them as additions and deletions that no longer exist anywhere
		if (this.deps.isDiffMode()) this.deps.captureDiffSnapshot();
	};

	/** the work itself; resolves to the last failure's words, if any */
	async #throwAway(root: string, changes: GitStatusEntry[]): Promise<string | undefined> {
		// new files go to the Trash; tracked files go back to the last version. A rename is both: the
		// new name is a new file, and the old one comes back.
		const fresh = changes.filter((c) => isNewFile(c) || c.from);
		const tracked = [...changes.filter((c) => !isNewFile(c) && !c.from).map((c) => c.path), ...fresh.flatMap((c) => c.from ?? [])];
		let err: string | undefined;
		// one staged as added (in a terminal, or by a save that stopped half-way) is let go of first
		const staged = fresh.filter((c) => c.x !== '?').map((c) => c.path);
		if (staged.length) {
			const res = await gitUnstage(root, staged);
			if (!res.ok) err = res.error;
		}
		const kept: string[] = [];
		for (const c of fresh) {
			try {
				if ((await this.deps.trashEntry(c.path)) === 'kept') kept.push(c.path);
			} catch (e) {
				err = e instanceof Error ? e.message : String(e);
			}
		}
		if (kept.length && (await this.#deleteOutright(kept))) {
			for (const p of kept) {
				try {
					await this.deps.removeEntry(p);
				} catch (e) {
					err = e instanceof Error ? e.message : String(e);
				}
			}
		}
		if (tracked.length) {
			const res = await gitDiscard(root, tracked);
			if (!res.ok) err = res.error;
		}
		return err;
	}

	#deleteOutright(paths: string[]): Promise<boolean> {
		const one = paths.length === 1;
		const msg = one ? m.vcs_confirm_no_trash_one({ name: basename(paths[0]) }) : m.vcs_confirm_no_trash_other({ count: paths.length });
		const detail = one ? m.vcs_confirm_no_trash_one_detail() : m.vcs_confirm_no_trash_other_detail();
		return confirmAsk(msg, { detail, confirmLabel: m.vcs_delete_permanently(), danger: true });
	}
}
