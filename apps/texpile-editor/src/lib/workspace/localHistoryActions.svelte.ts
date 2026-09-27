// What the Timeline does with a Local History entry, as VS Code's local history commands do:
// Compare with File (the row's click), Restore Contents, Rename, Delete, and Create Entry. A module
// the workspace provides while it is open, like scmHandlers.svelte.ts: the Timeline sits in the
// explorer, nowhere near the editor it acts on.
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
	/** drop the file's queued autosave: a restore replaces what it was about to write */
	discardPendingSave(): void;
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

	/** a git version of the file against the file as it is now: the Timeline's git rows */
	compareVersion(path: string, hash: string, subject: string, pathThen?: string): void {
		this.deps.openCompareTab(path, { hash, subject, ...(pathThen ? { path: pathThen } : {}) });
	}

	/** the entry against the file as it is now, in a compare tab */
	compare(path: string, entry: LocalHistoryEntry): void {
		this.deps.openCompareTab(path, {
			hash: `${LOCAL_REF}${entry.id}`,
			subject: `${sourceLabel(entry.source)} • ${entryDate(entry.timestamp)}`
		});
	}

	/** Restore Contents: asked first, then the file becomes the entry, and that is an entry of its own */
	async restore(path: string, entry: LocalHistoryEntry): Promise<void> {
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
		if (answer !== 'restore') return;
		const content = await readLocalHistory(path, entry.id);
		if (content === null) {
			toaster.error({ title: m.history_restore_failed({ name: basename(path) }), description: m.history_entry_gone() });
			return;
		}
		let current: string | null;
		// samePath: after a rename in the app the editor holds the path with / and Local History hands
		// it back with \ on Windows, and a miss left the queued save to land on the restored text
		const loaded = this.deps.getLoadedPath();
		const open = !!loaded && samePath(loaded, path);
		try {
			if (open) this.deps.discardPendingSave();
			// the file's own line endings, whatever the copy was kept with
			current = await this.deps.readTextIfPresent(path);
			await this.deps.writeText(path, current === null ? content : fromLf(toLf(content), detectEol(current)));
		} catch (e) {
			toaster.error({ title: m.history_restore_failed({ name: basename(path) }), description: e instanceof Error ? e.message : String(e) });
			return;
		}
		// a deleted file comes back (its folder too, if that went), and is opened
		if (current === null) openFile(path);
		else if (open && loaded) await this.deps.loadFile(loaded);
		await addLocalHistory(path, toLf(content), 'restored');
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
