// Local History, as VS Code keeps it (workbench.localHistory): every save of a file puts a copy of
// it under the app's own data, so a morning's work is not protected only by undo in a project that
// has never been put under git. Same layout as VS Code's User/History: a folder per file, named by
// a hash of its path, holding the copies and an entries.json that lists them.
//
// The same rules too: saves from the same source within the merge window replace the last entry
// rather than add one (autosave would otherwise fill the list in minutes), a file keeps its last 50
// entries, and files over 256 KB are not kept. A rename or move carries the entries along.
//
// Nothing here reads the file being tracked: the window hands over what it saved, so a path can
// never be used to pull an arbitrary file into the history and read it back out.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

export type LocalHistoryEntry = {
	/** the copy's file name in the history folder: four characters and the file's extension */
	id: string;
	timestamp: number;
	/** 'restored', 'renamed', 'moved', or a name the author gave it; absent for an ordinary save */
	source?: string;
	/** for a rename or move, where the file was before */
	sourceDescription?: string;
};

type Model = { version: 1; resource: string; entries: LocalHistoryEntry[] };

export const LOCAL_HISTORY_LIMITS = { maxEntries: 50, maxFileSize: 256 * 1024, mergeWindowMs: 10_000 };

const ENTRIES_FILE = 'entries.json';
const ID_RE = /^[A-Za-z0-9]{4}(\.[^\\/]{1,32})?$/;

/** the path as it names a file here: resolved, and case-folded where the file system folds case */
export function resourceKey(path: string): string {
	const abs = resolve(path);
	return process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs;
}

function folderName(resource: string): string {
	return createHash('sha1').update(resourceKey(resource)).digest('hex').slice(0, 16);
}

function randomId(resource: string): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	const bytes = randomBytes(4);
	const ext = extname(resource);
	return [...bytes].map((b) => alphabet[b % alphabet.length]).join('') + (ext.length <= 33 ? ext : '');
}

export class LocalHistory {
	// one operation at a time: a save, a move and a restore can arrive together, and each rewrites
	// entries.json from what it read
	private chain: Promise<unknown> = Promise.resolve();

	constructor(
		private home: string,
		private limits = LOCAL_HISTORY_LIMITS
	) {}

	private queue<T>(op: () => Promise<T>): Promise<T> {
		const next = this.chain.then(op, op);
		this.chain = next.catch(() => undefined);
		return next;
	}

	private folder(resource: string): string {
		return join(this.home, folderName(resource));
	}

	private async load(resource: string): Promise<Model> {
		try {
			const parsed = JSON.parse(await readFile(join(this.folder(resource), ENTRIES_FILE), 'utf8')) as Model;
			if (parsed && Array.isArray(parsed.entries)) {
				return { version: 1, resource: parsed.resource, entries: parsed.entries.filter((e) => ID_RE.test(e.id)) };
			}
		} catch {
			// no history yet, or a listing that cannot be read: start again rather than fail the save
		}
		return { version: 1, resource: resolve(resource), entries: [] };
	}

	private async store(resource: string, model: Model): Promise<void> {
		const dir = this.folder(resource);
		if (!model.entries.length) {
			await rm(dir, { recursive: true, force: true });
			return;
		}
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, ENTRIES_FILE), JSON.stringify(model));
	}

	/** drop the oldest past the limit, files and all */
	private async trim(resource: string, model: Model): Promise<void> {
		const excess = model.entries.length - this.limits.maxEntries;
		if (excess <= 0) return;
		for (const old of model.entries.splice(0, excess)) await rm(join(this.folder(resource), old.id), { force: true });
	}

	/**
	 * A save: a new entry, or the last one replaced when it came from the same source within the
	 * merge window. Nothing when the file is over the size limit, or the content is what the last
	 * entry already holds. Resolves to the entry, or null when nothing was kept.
	 */
	add(
		resource: string,
		content: string,
		source?: string,
		sourceDescription?: string,
		timestamp = Date.now()
	): Promise<LocalHistoryEntry | null> {
		return this.queue(async () => {
			if (Buffer.byteLength(content, 'utf8') > this.limits.maxFileSize) return null;
			const model = await this.load(resource);
			const dir = this.folder(resource);
			const last = model.entries.at(-1);
			if (last && last.source === source) {
				const previous = await readFile(join(dir, last.id), 'utf8').catch(() => null);
				if (previous === content) return last;
				if (timestamp - last.timestamp <= this.limits.mergeWindowMs) {
					await writeFile(join(dir, last.id), content);
					last.timestamp = timestamp;
					last.sourceDescription = sourceDescription;
					await this.store(resource, model);
					return last;
				}
			}
			await mkdir(dir, { recursive: true });
			const entry: LocalHistoryEntry = {
				id: randomId(resource),
				timestamp,
				...(source ? { source } : {}),
				...(sourceDescription ? { sourceDescription } : {})
			};
			await writeFile(join(dir, entry.id), content);
			model.entries.push(entry);
			await this.trim(resource, model);
			await this.store(resource, model);
			return entry;
		});
	}

	/** oldest first, as VS Code keeps them */
	list(resource: string): Promise<LocalHistoryEntry[]> {
		return this.queue(async () => (await this.load(resource)).entries.slice(-this.limits.maxEntries));
	}

	/** an entry's contents; null for an id the file's history does not list */
	read(resource: string, id: string): Promise<string | null> {
		return this.queue(async () => {
			const model = await this.load(resource);
			if (!model.entries.some((e) => e.id === id)) return null;
			return readFile(join(this.folder(resource), id), 'utf8').catch(() => null);
		});
	}

	remove(resource: string, id: string): Promise<boolean> {
		return this.queue(async () => {
			const model = await this.load(resource);
			const at = model.entries.findIndex((e) => e.id === id);
			if (at < 0) return false;
			model.entries.splice(at, 1);
			await rm(join(this.folder(resource), id), { force: true });
			await this.store(resource, model);
			return true;
		});
	}

	/** VS Code's Rename: the entry's label, which is its source */
	rename(resource: string, id: string, label: string): Promise<boolean> {
		return this.queue(async () => {
			const name = label.trim();
			const model = await this.load(resource);
			const entry = model.entries.find((e) => e.id === id);
			if (!entry || !name) return false;
			entry.source = name;
			await this.store(resource, model);
			return true;
		});
	}

	/** VS Code's Delete All: every entry of every file */
	removeAll(): Promise<void> {
		return this.queue(() => rm(this.home, { recursive: true, force: true }));
	}

	/**
	 * A file or folder was renamed or moved: every file under `from` takes its entries to its new
	 * path, merged with any the new path already had, and gets one more entry saying where it was
	 * (a copy of its newest one: nothing is read from disk here). Resolves to the new paths.
	 */
	move(from: string, to: string): Promise<string[]> {
		return this.queue(async () => {
			const src = resourceKey(from);
			const moved: string[] = [];
			let folders: string[] = [];
			try {
				folders = await readdir(this.home);
			} catch {
				return moved;
			}
			for (const name of folders) {
				let model: Model;
				try {
					model = JSON.parse(await readFile(join(this.home, name, ENTRIES_FILE), 'utf8')) as Model;
				} catch {
					continue;
				}
				const key = resourceKey(model.resource);
				if (key !== src && !key.startsWith(src + sep)) continue;
				const target = resolve(to) + resolve(model.resource).slice(resolve(from).length);
				const into = await this.load(target);
				const targetDir = this.folder(target);
				await mkdir(targetDir, { recursive: true });
				for (const entry of model.entries.filter((e) => ID_RE.test(e.id))) {
					const bytes = await readFile(join(this.home, name, entry.id)).catch(() => null);
					if (!bytes || into.entries.some((e) => e.id === entry.id)) continue;
					await writeFile(join(targetDir, entry.id), bytes);
					into.entries.push(entry);
				}
				into.entries.sort((a, b) => a.timestamp - b.timestamp);
				into.resource = target;
				const newest = into.entries.at(-1);
				if (newest) {
					const same = resolve(target, '..') === resolve(model.resource, '..');
					const copy: LocalHistoryEntry = {
						id: randomId(target),
						timestamp: Date.now(),
						source: same ? 'renamed' : 'moved',
						sourceDescription: model.resource
					};
					const bytes = await readFile(join(targetDir, newest.id)).catch(() => null);
					if (bytes) {
						await writeFile(join(targetDir, copy.id), bytes);
						into.entries.push(copy);
					}
				}
				await this.trim(target, into);
				await this.store(target, into);
				if (folderName(target) !== name) await rm(join(this.home, name), { recursive: true, force: true });
				moved.push(target);
			}
			return moved;
		});
	}
}
