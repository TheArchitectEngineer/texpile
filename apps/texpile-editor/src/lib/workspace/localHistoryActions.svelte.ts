// What the Local History dialog does with a copy, as VS Code's local history commands do: Restore,
// Rename, Delete, and Save a Copy Now (VS Code's Create Entry). A module the workspace provides
// while it is open, like scmHandlers.svelte.ts: the dialog is drawn apart from the editor it acts on.
import {
	addLocalHistory,
	readLocalHistory,
	removeLocalHistory,
	renameLocalHistory,
	removeAllLocalHistory,
	sourceLabel,
	LOCAL_REF,
	type LocalHistoryEntry
} from './localHistory.svelte';
import { basename, detectEol, fromLf, samePath, toLf } from './fileSystem';
import { openFile } from './workspaceStore';
import { promptAsk } from '$lib/modals/confirm.svelte';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';

export type LocalHistoryDeps = {
	getLoadedPath(): string | null;
	/** write the file's queued autosave now: a restore keeps what it replaces, unsaved edits included */
	flushPendingSave(): Promise<void>;
	/** resolves once a save already being written has landed, so it cannot land on the restore */
	whenSaved(): Promise<void>;
	/** null when the file is gone */
	readTextIfPresent(path: string): Promise<string | null>;
	writeText(path: string, content: string): Promise<void>;
	loadFile(path: string): Promise<void>;
	openCompareTab(path: string, compare: { hash: string; subject: string; path?: string }): void;
};

/** "5 Mar 2026, 14:02": VS Code's local history date label */
export function entryDate(timestamp: number): string {
	return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export class LocalHistoryActions {
	constructor(private deps: LocalHistoryDeps) {}

	/** the entry against the file as it is now, in a compare tab */
	compare(path: string, entry: LocalHistoryEntry): void {
		this.deps.openCompareTab(path, {
			hash: `${LOCAL_REF}${entry.id}`,
			subject: `${sourceLabel(entry.source)} · ${entryDate(entry.timestamp)}`
		});
	}

	/** Restore: asked first, then the file becomes the copy, and that is an entry of its own. What it
	 *  held, unsaved edits included, is kept first as Before Restore, and the notice offers Undo. */
	async restore(path: string, entry: LocalHistoryEntry): Promise<boolean> {
		const answer = await promptAsk({
			title: m.history_restore_title(),
			message: m.history_restore_message({ name: basename(path) }),
			detail: m.history_restore_detail(),
			buttons: [
				{ id: 'restore', label: m.history_restore(), primary: true },
				{ id: 'cancel', label: m.vcs_cancel() }
			],
			cancelId: 'cancel'
		});
		if (answer !== 'restore') return false;
		const content = await readLocalHistory(path, entry.id);
		if (content === null) {
			toaster.error({ title: m.history_restore_failed({ name: basename(path) }), description: m.history_entry_gone() });
			return false;
		}
		let current: string | null;
		// samePath: after a rename in the app the editor holds the path with / and Local History hands
		// it back with \ on Windows, and a miss left the queued save to land on the restored text
		const loaded = this.deps.getLoadedPath();
		const open = !!loaded && samePath(loaded, path);
		try {
			if (open) await this.deps.flushPendingSave();
			await this.deps.whenSaved();
			// the file's own line endings, whatever the copy was kept with
			current = await this.deps.readTextIfPresent(path);
			// what the restore replaces, so restoring is undone the same way
			if (current !== null) await addLocalHistory(path, toLf(current), 'before-restore');
			await this.deps.writeText(path, current === null ? content : fromLf(toLf(content), detectEol(current)));
		} catch (e) {
			toaster.error({ title: m.history_restore_failed({ name: basename(path) }), description: e instanceof Error ? e.message : String(e) });
			return false;
		}
		// a deleted file comes back (its folder too, if that went), and is opened
		if (current === null) openFile(path);
		else if (open && loaded) await this.deps.loadFile(loaded);
		await addLocalHistory(path, toLf(content), 'restored');
		// said, as restoring a version is: the file may not be the one on screen
		const before = current;
		toaster.success({
			title: m.history_toast_restored({ name: basename(path) }),
			...(before !== null ? { action: { label: m.vcs_undo(), onClick: () => void this.undoRestore(path, before) } } : {})
		});
		return true;
	}

	/** Undo on the notice: the text the file had before, written back */
	private async undoRestore(path: string, before: string): Promise<void> {
		try {
			await this.deps.writeText(path, before);
		} catch (e) {
			toaster.error({ title: m.history_restore_failed({ name: basename(path) }), description: e instanceof Error ? e.message : String(e) });
			return;
		}
		const loaded = this.deps.getLoadedPath();
		if (loaded && samePath(loaded, path)) await this.deps.loadFile(loaded);
	}

	/** the file as it is on disk now; null when it is gone */
	currentText(path: string): Promise<string | null> {
		return this.deps.readTextIfPresent(path);
	}

	/** Rename: the entry's label, which starts as how it was made ("File Saved") */
	async rename(path: string, entry: LocalHistoryEntry, name: string): Promise<void> {
		if (name.trim()) await renameLocalHistory(path, entry.id, name.trim());
	}

	async remove(path: string, entry: LocalHistoryEntry): Promise<void> {
		const answer = await promptAsk({
			message: m.history_delete_message({ name: basename(path), date: entryDate(entry.timestamp) }),
			detail: m.history_irreversible(),
			buttons: [
				{ id: 'delete', label: m.history_delete(), primary: true },
				{ id: 'cancel', label: m.vcs_cancel() }
			],
			cancelId: 'cancel',
			danger: true
		});
		if (answer === 'delete') await removeLocalHistory(path, entry.id);
	}

	/** Delete All: every entry of every file */
	async removeAll(): Promise<void> {
		const answer = await promptAsk({
			message: m.history_delete_all_message(),
			detail: m.history_irreversible(),
			buttons: [
				{ id: 'delete', label: m.history_delete_all(), primary: true },
				{ id: 'cancel', label: m.vcs_cancel() }
			],
			cancelId: 'cancel',
			danger: true
		});
		if (answer === 'delete') await removeAllLocalHistory();
	}

	/** Create Entry: the file as it is on disk now, under a name the author gives it */
	async create(path: string, name: string): Promise<void> {
		if (!name.trim()) return;
		const content = await this.deps.readTextIfPresent(path);
		if (content === null) return;
		if (!(await addLocalHistory(path, toLf(content), name.trim()))) toaster.error({ title: m.history_create_failed() });
	}
}

let current = $state<LocalHistoryActions | null>(null);

export const localHistoryActions = {
	get current(): LocalHistoryActions | null {
		return current;
	}
};

/** the workspace provides them while it is open; the returned function lets go */
export function provideLocalHistoryActions(actions: LocalHistoryActions): () => void {
	current = actions;
	return () => {
		if (current === actions) current = null;
	};
}
