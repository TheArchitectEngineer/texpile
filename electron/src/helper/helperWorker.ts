// Entry of the helper utility process: git and the workspace watcher run here, not in the main
// process. On Windows both do their setup synchronously on the calling thread (a spawn creates
// the child in CreateProcess, chokidar opens one directory handle per watched entry), and the
// main process is also what serves the renderer its code chunks: those holds left the editor
// waiting on a blank pane (startupStats.ts caught it). helperProcess.ts is the other end.
import * as gitService from '../gitService';
import * as gitRemote from '../gitRemote';
import * as gitHistory from '../gitHistory';
import * as gitCombine from '../gitCombine';
import * as gitBranches from '../gitBranches';
import * as gitTags from '../gitTags';
import { gitClone } from '../gitClone';
import type { GitAuthEnv } from '../gitRemote';
import { startWorkspaceWatch, stopWorkspaceWatch } from '../fs/fsWatch';
import { pathKey } from '../shell/toolDirs';

type Call = { id: number; op: string; args: unknown[] };

// Every git here inherits this process's environment, and several answers are read from git's
// English words: why a push failed, which files block a merge, that a file has no committed
// version. A translated git slips past all of them. VS Code pins the same three.
//
// GIT_OPTIONAL_LOCKS=0 keeps `git status` from taking .git/index.lock to refresh the index as a
// side effect. Status runs on every watcher event and window focus, and holding that lock made a
// Save version or Sync running at the same moment fail; it would also make the watcher's own
// refresh rewrite the index it watches.
Object.assign(process.env, { LANGUAGE: 'en', LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8', GIT_OPTIONAL_LOCKS: '0' });

const port = process.parentPort;

/** clones under way, by the key main gave each */
const clones = new Map<string, AbortController>();

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
	if (op === 'git.gitClone') {
		// the one git call that reports as it goes, and the one that can be stopped: both by the key
		// in its last argument
		const [url, parent, name, auth, key] = args as [string, string, string, GitAuthEnv, string];
		const stop = new AbortController();
		clones.set(key, stop);
		return gitClone(url, parent, name, auth, (data) => port.postMessage({ event: 'git-progress', key, data }), stop.signal).finally(() =>
			clones.delete(key)
		);
	}
	if (op === 'git.cancelClone') {
		clones.get(args[0] as string)?.abort();
		return true;
	}
	if (op.startsWith('git.')) {
		const name = op.slice(4);
		const fn =
			(gitService as Record<string, unknown>)[name] ??
			(gitHistory as Record<string, unknown>)[name] ??
			(gitRemote as Record<string, unknown>)[name] ??
			(gitCombine as Record<string, unknown>)[name] ??
			(gitBranches as Record<string, unknown>)[name] ??
			(gitTags as Record<string, unknown>)[name];
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
