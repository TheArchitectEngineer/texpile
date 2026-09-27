// The history:* surface: Local History (localHistory.ts), kept where VS Code keeps it, in the app's
// own data rather than the project, so it is there for a folder that never had git and never
// travels with the project.
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { handleFs } from './ipcResult';
import { LocalHistory } from '../localHistory';

let history: LocalHistory | null = null;

function store(): LocalHistory {
	return (history ??= new LocalHistory(join(app.getPath('userData'), 'History')));
}

function path(p: unknown): string {
	if (typeof p !== 'string' || !isAbsolute(p)) throw new Error('Not an absolute path');
	return p;
}

function text(s: unknown, max = Infinity): string {
	if (typeof s !== 'string' || s.length > max) throw new Error('Not a string');
	return s;
}

export function registerLocalHistoryIpc(): void {
	// what the window saved, from the source that saved it; `source` absent for an ordinary save
	handleFs('history:add', async (p: unknown, content: unknown, source?: unknown) =>
		store().add(path(p), text(content), source === undefined ? undefined : text(source, 200))
	);
	handleFs('history:list', async (p: unknown) => store().list(path(p)));
	handleFs('history:read', async (p: unknown, id: unknown) => store().read(path(p), text(id, 64)));
	handleFs('history:remove', async (p: unknown, id: unknown) => store().remove(path(p), text(id, 64)));
	handleFs('history:rename', async (p: unknown, id: unknown, label: unknown) => store().rename(path(p), text(id, 64), text(label, 200)));
	handleFs('history:removeAll', async () => store().removeAll());
	// the project's files with history, and whether each is still there
	handleFs('history:all', async (root: unknown) => (await store().all(path(root))).map((f) => ({ ...f, exists: existsSync(f.resource) })));
	handleFs('history:move', async (from: unknown, to: unknown) => store().move(path(from), path(to)));
}
