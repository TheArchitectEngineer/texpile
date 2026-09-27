// Entry of the helper utility process: git and the workspace watcher run here, not in the main
// process. On Windows both do their setup synchronously on the calling thread (a spawn creates
// the child in CreateProcess, chokidar opens one directory handle per watched entry), and the
// main process is also what serves the renderer its code chunks: those holds left the editor
// waiting on a blank pane (startupStats.ts caught it). helperProcess.ts is the other end.
import * as gitService from '../gitService';
import * as gitRemote from '../gitRemote';
import { startWorkspaceWatch, stopWorkspaceWatch } from '../fs/fsWatch';
import { pathKey } from '../shell/toolDirs';

type Call = { id: number; op: string; args: unknown[] };

// Every git here inherits this process's environment, and several answers are read from git's
// English words: why a push failed, which files block a merge, that a file has no committed
// version. A translated git slips past all of them. VS Code pins the same three.
Object.assign(process.env, { LANGUAGE: 'en', LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' });

const port = process.parentPort;

function run(op: string, args: unknown[]): unknown {
	if (op === 'watch.start') {
		const [key, root] = args as [string, string];
		startWorkspaceWatch(key, root, () => port.postMessage({ event: 'fs-changed', key }));
		return true;
	}
	if (op === 'watch.stop') {
		stopWorkspaceWatch(args[0] as string);
		return true;
	}
	if (op === 'env.path') {
		process.env[pathKey()] = args[0] as string;
		return true;
	}
	if (op.startsWith('git.')) {
		const name = op.slice(4);
		const fn = (gitService as Record<string, unknown>)[name] ?? (gitRemote as Record<string, unknown>)[name];
		if (typeof fn === 'function') return (fn as (...a: unknown[]) => unknown)(...args);
	}
	throw new Error(`unknown helper op ${op}`);
}

port.on('message', (e) => {
	const { id, op, args } = e.data as Call;
	Promise.resolve()
		.then(() => run(op, args))
		.then(
			(value) => port.postMessage({ id, ok: true, value }),
			(err: unknown) => port.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
		);
});
