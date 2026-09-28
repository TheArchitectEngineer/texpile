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
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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

/** four characters and the file's extension, as VS Code names a copy; never one the file already
 *  has, compared as macOS's and Windows's disks do, without case: "aB3d" there is "Ab3D", and the
 *  new copy would be written over an older one */
function randomId(resource: string, taken: { id: string }[]): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	const ext = extname(resource);
	const used = new Set(taken.map((e) => e.id.toLowerCase()));
	for (;;) {
		const stem = [...randomBytes(4)].map((b) => alphabet[b % alphabet.length]).join('');
		// an extension load() would not recognise (too long, or a name ending in ".") is left off:
		// a copy it cannot list is never shown, trimmed or removed
		const id = ID_RE.test(stem + ext) ? stem + ext : stem;
		if (!used.has(id.toLowerCase())) return id;
	}
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

	/**
	 * The file's entries, rebuilt from the copies in its folder as VS Code rebuilds them: entries.json
	 * adds the labels and times. A listing lost or cut short (a crash while it was written) then
	 * costs only labels; the copies stay listed, and are trimmed and removed like any other.
	 */
	private async load(resource: string): Promise<Model> {
		const dir = this.folder(resource);
		let names: string[];
		try {
			names = (await readdir(dir)).filter((n) => n !== ENTRIES_FILE && ID_RE.test(n));
		} catch {
			return { version: 1, resource: resolve(resource), entries: [] };
		}
		let listed: LocalHistoryEntry[] = [];
		let stored = resolve(resource);
		try {
			const parsed = JSON.parse(await readFile(join(dir, ENTRIES_FILE), 'utf8')) as Model;
			if (parsed && Array.isArray(parsed.entries)) listed = parsed.entries.filter((e) => ID_RE.test(e.id));
			if (typeof parsed?.resource === 'string') stored = parsed.resource;
		} catch {
			// no listing, or one that cannot be read: the copies alone, timed by when they were written
		}
		const present = new Set(names);
		const entries = listed.filter((e) => present.has(e.id));
		const known = new Set(entries.map((e) => e.id));
		for (const id of names) {
			if (known.has(id)) continue;
			const written = await stat(join(dir, id)).catch(() => null);
			if (written) entries.push({ id, timestamp: written.mtimeMs });
		}
		entries.sort((a, b) => a.timestamp - b.timestamp);
		return { version: 1, resource: stored, entries };
	}

	private async store(resource: string, model: Model): Promise<void> {
		const dir = this.folder(resource);
		if (!model.entries.length) {
			await rm(dir, { recursive: true, force: true });
			return;
		}
		await mkdir(dir, { recursive: true });
		// written aside and renamed over the old one, so a crash leaves one listing or the other
		const aside = join(dir, `.${ENTRIES_FILE}.${randomBytes(4).toString('hex')}`);
		await writeFile(aside, JSON.stringify(model));
		await rename(aside, join(dir, ENTRIES_FILE));
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
			// a save that changed nothing adds nothing, whatever made the last entry: Ctrl+S right after a
			// rename or a restore would otherwise spend one of the 50 on a second copy of it (VS Code's
			// tracker skips it too). An entry the author asked for by name is kept regardless
			if (last && (last.source === source || !source)) {
				const previous = await readFile(join(dir, last.id), 'utf8').catch(() => null);
				if (previous === content) return last;
			}
			if (last && last.source === source) {
				if (timestamp - last.timestamp <= this.limits.mergeWindowMs) {
					await writeFile(join(dir, last.id), content);
					last.timestamp = timestamp;
					// the window replacing a rename's entry with what is on disk keeps where it came from
					last.sourceDescription = sourceDescription ?? last.sourceDescription;
					await this.store(resource, model);
					return last;
				}
			}
			await mkdir(dir, { recursive: true });
			const entry: LocalHistoryEntry = {
				id: randomId(resource, model.entries),
				timestamp,
				...(source ? { source } : {}),
				...(sourceDescription ? { sourceDescription } : {})
			};
			model.entries.push(entry);
			// a file's first copy: its listing goes first, so the folder says whose it is before any copy
			// is in it. Copies with no listing belong to no file that all() or move() can name; a listing
			// whose copy never arrived loses only that entry (load() skips it)
			if (model.entries.length === 1) await this.store(resource, model);
			await writeFile(join(dir, entry.id), content);
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

	/**
	 * Every file with history under `under`, newest first, whether or not it is still there: VS
	 * Code's Find Entry to Restore, which is how a deleted file's copies are found at all, since the
	 * Timeline shows only a file that is open.
	 */
	all(under: string): Promise<{ resource: string; count: number; newest: number }[]> {
		return this.queue(async () => {
			// a project at the root of a drive already ends in a separator
			const key = resourceKey(under);
			const prefix = key.endsWith(sep) ? key : key + sep;
			let folders: string[];
			try {
				folders = await readdir(this.home);
			} catch {
				return [];
			}
			const found: { resource: string; count: number; newest: number }[] = [];
			for (const name of folders) {
				let resource: string;
				try {
					resource = (JSON.parse(await readFile(join(this.home, name, ENTRIES_FILE), 'utf8')) as Model).resource;
				} catch {
					continue;
				}
				if (typeof resource !== 'string' || !resourceKey(resource).startsWith(prefix)) continue;
				const { entries } = await this.load(resource);
				if (entries.length) found.push({ resource, count: entries.length, newest: entries.at(-1)!.timestamp });
			}
			return found.sort((a, b) => b.newest - a.newest);
		});
	}

	/** VS Code's Delete All: every entry of every file */
	removeAll(): Promise<void> {
		return this.queue(() => rm(this.home, { recursive: true, force: true }));
	}

	/**
	 * A file or folder was renamed or moved: every file under `from` takes its entries to its new
	 * path, merged with any the new path already had, and gets one more entry saying where it was.
	 * Nothing is read from disk here, so that entry starts as a copy of the file's own newest one; the
	 * window then hands over what the file holds now (moveLocalHistory), which replaces it inside the
	 * merge window, as VS Code's entry is a copy of the file itself. Resolves to the new paths.
	 */
	move(from: string, to: string): Promise<string[]> {
		return this.queue(async () => {
			const src = resourceKey(from);
			// The file itself is found by its own folder, whose name comes from its path, so a listing
			// that cannot be read does not strand its copies under the old name (load() rebuilds it).
			// Files under a moved folder can only be found by their listings, where their paths are.
			const sources: string[] = [];
			if ((await this.load(from)).entries.length) sources.push(resolve(from));
			let folders: string[] = [];
			try {
				folders = await readdir(this.home);
			} catch {
				// nothing kept yet
			}
			for (const name of folders) {
				let resource: unknown;
				try {
					resource = (JSON.parse(await readFile(join(this.home, name, ENTRIES_FILE), 'utf8')) as Model).resource;
				} catch {
					continue;
				}
				if (typeof resource === 'string' && resourceKey(resource).startsWith(src + sep)) sources.push(resource);
			}
			const moved: string[] = [];
			for (const source of sources) {
				const target = resolve(to) + resolve(source).slice(resolve(from).length);
				if (await this.carry(source, target)) moved.push(target);
			}
			return moved;
		});
	}

	/** One file's entries to its new path; false when it had none. The old folder is removed only
	 *  once every copy is across: one another program holds open for a moment (an indexer, a virus
	 *  scan on Windows) keeps the folder, and the rest with it, rather than being lost. */
	private async carry(source: string, target: string): Promise<boolean> {
		const carried = (await this.load(source)).entries;
		if (!carried.length) return false;
		const fromDir = this.folder(source);
		const toDir = this.folder(target);
		// a rename that only changes case on macOS or Windows keeps the same folder: nothing to carry
		const same = fromDir === toDir;
		const into: Model = same ? { version: 1, resource: target, entries: carried } : await this.load(target);
		let complete = true;
		// this file's newest copy that made it across, which the entry below repeats: the newest in
		// `into` may be another file's, one deleted from the new path earlier
		let newest = same ? carried.at(-1) : undefined;
		if (!same) {
			await mkdir(toDir, { recursive: true });
			for (const entry of carried) {
				let bytes: Buffer;
				try {
					bytes = await readFile(join(fromDir, entry.id));
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code !== 'ENOENT') complete = false;
					continue;
				}
				// compared without case, as macOS's and Windows's disks compare names: a copy the new path
				// already has under the same name would be written over, so this one gets a name of its own
				const taken = into.entries.some((e) => e.id.toLowerCase() === entry.id.toLowerCase());
				const copy = taken ? { ...entry, id: randomId(target, into.entries) } : entry;
				await writeFile(join(toDir, copy.id), bytes);
				into.entries.push(copy);
				newest = copy;
			}
			into.entries.sort((a, b) => a.timestamp - b.timestamp);
		}
		into.resource = target;
		if (newest) {
			const entry: LocalHistoryEntry = {
				id: randomId(target, into.entries),
				timestamp: Date.now(),
				source: resolve(target, '..') === resolve(source, '..') ? 'renamed' : 'moved',
				sourceDescription: source
			};
			const bytes = await readFile(join(toDir, newest.id)).catch(() => null);
			if (bytes) {
				await writeFile(join(toDir, entry.id), bytes);
				into.entries.push(entry);
			}
		}
		await this.trim(target, into);
		await this.store(target, into);
		if (!same && complete) await rm(fromDir, { recursive: true, force: true });
		return true;
	}
}
