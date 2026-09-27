// Local History as VS Code keeps it: a copy per save, saves close together from one source merged,
// the newest 50 kept, big files skipped, and a rename taking the entries along.
import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalHistory } from '../../../../../../electron/src/localHistory';

const homes: string[] = [];
afterEach(() => {
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function history(limits = { maxEntries: 50, maxFileSize: 1024, mergeWindowMs: 10_000 }) {
	const home = mkdtempSync(join(tmpdir(), 'texpile-history-'));
	homes.push(home);
	return { h: new LocalHistory(home, limits), home };
}

const FILE = join(tmpdir(), 'project', 'chapters', 'intro.tex');

it('keeps a copy per save, and merges saves within the window into the last one', async () => {
	const { h } = history();
	await h.add(FILE, 'one', undefined, undefined, 1_000);
	await h.add(FILE, 'two', undefined, undefined, 5_000); // 4 s later: replaces
	await h.add(FILE, 'three', undefined, undefined, 30_000); // 25 s later: a new entry
	const entries = await h.list(FILE);
	expect(entries.map((e) => e.timestamp)).toEqual([5_000, 30_000]);
	expect(await h.read(FILE, entries[0].id)).toBe('two');
	expect(await h.read(FILE, entries[1].id)).toBe('three');
	expect(entries[0].id).toMatch(/^[A-Za-z0-9]{4}\.tex$/);
});

it('does not merge across sources, and adds nothing for a save that changed nothing', async () => {
	const { h } = history();
	await h.add(FILE, 'text', undefined, undefined, 1_000);
	await h.add(FILE, 'text', undefined, undefined, 60_000);
	await h.add(FILE, 'text', 'restored', undefined, 61_000);
	expect((await h.list(FILE)).map((e) => e.source)).toEqual([undefined, 'restored']);
});

it('keeps the newest entries up to the limit, and skips files over the size limit', async () => {
	const { h, home } = history({ maxEntries: 3, maxFileSize: 10, mergeWindowMs: 0 });
	for (let i = 0; i < 5; i++) await h.add(FILE, `v${i}`, undefined, undefined, i * 1_000 + 1);
	const entries = await h.list(FILE);
	expect(await Promise.all(entries.map((e) => h.read(FILE, e.id)))).toEqual(['v2', 'v3', 'v4']);
	// the dropped copies are gone from disk as well: three copies and the listing
	expect(readdirSync(join(home, readdirSync(home)[0]))).toHaveLength(4);
	expect(await h.add(FILE, 'far too long for the limit', undefined, undefined, 99_000)).toBeNull();
});

it('reads only ids the file lists, never a path', async () => {
	const { h } = history();
	await h.add(FILE, 'text');
	expect(await h.read(FILE, '../../etc/passwd')).toBeNull();
	expect(await h.read(FILE, 'zzzz.tex')).toBeNull();
});

it('renames and deletes entries, and Delete All clears every file', async () => {
	const { h } = history();
	const e = (await h.add(FILE, 'text'))!;
	expect(await h.rename(FILE, e.id, 'Sent to the committee')).toBe(true);
	expect((await h.list(FILE))[0].source).toBe('Sent to the committee');
	expect(await h.remove(FILE, e.id)).toBe(true);
	expect(await h.list(FILE)).toEqual([]);
	await h.add(FILE, 'again');
	await h.removeAll();
	expect(await h.list(FILE)).toEqual([]);
});

it('takes the entries along when a file or its folder moves, and says where it was', async () => {
	const { h } = history();
	await h.add(FILE, 'first', undefined, undefined, 1_000);
	await h.add(FILE, 'second', undefined, undefined, 50_000);
	const renamed = join(tmpdir(), 'project', 'chapters', 'introduction.tex');
	expect(await h.move(FILE, renamed)).toEqual([renamed]);
	expect(await h.list(FILE)).toEqual([]);
	const after = await h.list(renamed);
	expect(after.map((e) => e.source)).toEqual([undefined, undefined, 'renamed']);
	expect(after[2].sourceDescription).toBe(FILE);
	expect(await h.read(renamed, after[2].id)).toBe('second');

	const moved = join(tmpdir(), 'project', 'parts', 'introduction.tex');
	expect(await h.move(join(tmpdir(), 'project', 'chapters'), join(tmpdir(), 'project', 'parts'))).toEqual([moved]);
	expect((await h.list(moved)).at(-1)?.source).toBe('moved');
});

it('replaces the rename entry with what the file holds now, keeping where it came from', async () => {
	const { h } = history();
	await h.add(FILE, 'saved in the app', undefined, undefined, 1_000);
	const renamed = join(tmpdir(), 'project', 'chapters', 'introduction.tex');
	await h.move(FILE, renamed);
	// what the window reads from disk after the rename: changed since by a pull
	await h.add(renamed, 'pulled since', 'renamed');
	const after = await h.list(renamed);
	expect(after.map((e) => e.source)).toEqual([undefined, 'renamed']);
	expect(after[1].sourceDescription).toBe(FILE);
	expect(await h.read(renamed, after[1].id)).toBe('pulled since');
});

it('keeps every copy when the listing is lost, as VS Code rebuilds it from the folder', async () => {
	const { h, home } = history();
	await h.add(FILE, 'one', undefined, undefined, 1_000);
	await h.add(FILE, 'two', undefined, undefined, 50_000);
	const [folder] = readdirSync(home);
	// a crash while entries.json was written
	writeFileSync(join(home, folder, 'entries.json'), '{"version":1,"reso');
	const listed = await h.list(FILE);
	expect(listed).toHaveLength(2);
	expect(await h.read(FILE, listed[0].id)).toBe('one');
	// the next save lists all three, and nothing is left behind unlisted
	await h.add(FILE, 'three', undefined, undefined, Date.now() + 60_000);
	expect(await h.list(FILE)).toHaveLength(3);
	expect(readdirSync(join(home, folder)).filter((n) => n !== 'entries.json')).toHaveLength(3);
});

it('lists every file with history under a folder, deleted ones too, newest first', async () => {
	const { h } = history();
	const project = join(tmpdir(), 'project');
	const methods = join(project, 'chapters', 'methods.tex');
	await h.add(FILE, 'intro', undefined, undefined, 1_000);
	await h.add(methods, 'methods', undefined, undefined, 5_000);
	await h.add(join(tmpdir(), 'elsewhere', 'other.tex'), 'not this project', undefined, undefined, 9_000);
	expect(await h.all(project)).toEqual([
		{ resource: methods, count: 1, newest: 5_000 },
		{ resource: FILE, count: 1, newest: 1_000 }
	]);
	// a folder named like the project's start is not inside it
	expect(await h.all(join(tmpdir(), 'proj'))).toEqual([]);
});
