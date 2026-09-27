// Cloning a project from its address into a new folder, for someone who was sent a GitHub link
// rather than a zip. VS Code's Git: Clone, minus the command line: the address and where to put
// it, a progress line while it downloads, and sign-in through the askpass bridge like any fetch.
import { simpleGit } from 'simple-git';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { errMsg, isMissingGit } from './gitService';
import { OWN_ENVIRONMENT, classifyPushError, isRemoteUrl, netEnv, type GitAuthEnv } from './gitRemote';

/** 'exists': the folder is already there and has something in it. 'not-found': nothing answers at
 *  that address, or not for this account. 'invalid': the address, folder or name cannot be used. */
export type CloneFailure = 'exists' | 'not-found' | 'invalid' | 'auth' | 'network' | 'cancelled' | 'other';

export type GitCloneResult = {
	ok: boolean;
	reason?: 'no-git';
	failure?: CloneFailure;
	error?: string;
	/** the new folder, absolute */
	path?: string;
};

/** how far along a clone is: git's own stage ('receiving', 'resolving', ...) and its percentage */
export type CloneProgress = { stage: string; percent: number };

// A private repository asked for with the wrong account reads as missing on GitHub and GitLab, so
// the message says to check both; checked after sign-in failures, which say so outright.
const NOT_FOUND_RE = /repository not found|does not appear to be a git repository|returned error: 404|not found|does not exist/i;

/** exported for the tests */
export function classifyCloneError(message: string): CloneFailure {
	const push = classifyPushError(message);
	if (push === 'auth') return 'auth';
	if (NOT_FOUND_RE.test(message)) return 'not-found';
	return push === 'network' ? 'network' : 'other';
}

/** a folder name, not a path: no separators, nothing Windows refuses, not . or .. */
export function isFolderName(name: string): boolean {
	const refused = [...name].some((c) => c.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(c));
	return !!name && name === name.trim() && !refused && name !== '.' && name !== '..';
}

async function occupied(dir: string): Promise<boolean> {
	try {
		return (await readdir(dir)).length > 0;
	} catch {
		return false; // not there yet, which is what a clone wants
	}
}

/**
 * `git clone` the address into `<parent>/<name>`. The folder must not exist yet, or be empty:
 * git refuses anything else, and saying so first means nothing is downloaded to be refused.
 * git removes a folder it created when the clone fails, so a failure leaves nothing behind.
 */
export async function gitClone(
	url: string,
	parent: string,
	name: string,
	auth: GitAuthEnv = {},
	onProgress?: (p: CloneProgress) => void,
	signal?: AbortSignal
): Promise<GitCloneResult> {
	if (!isRemoteUrl(url) || !isFolderName(name) || !isAbsolute(parent)) return { ok: false, failure: 'invalid' };
	try {
		if (!(await stat(parent)).isDirectory()) return { ok: false, failure: 'invalid' };
	} catch {
		return { ok: false, failure: 'invalid' };
	}
	const target = join(parent, name);
	if (await occupied(target)) return { ok: false, failure: 'exists', path: target };

	const g = simpleGit({
		baseDir: parent,
		binary: 'git',
		maxConcurrentProcesses: 1,
		config: ['core.quotePath=false'],
		unsafe: OWN_ENVIRONMENT,
		progress: ({ stage, progress }) => onProgress?.({ stage, percent: progress }),
		// git clone removes the folder it made when it is stopped, as when it fails
		abort: signal
	}).env(netEnv(auth));
	try {
		// `--` so an address can never be read as an option; isRemoteUrl already refuses one that could
		await g.raw(['clone', '--progress', '--recurse-submodules', '--', url.trim(), target]);
		return { ok: true, path: target };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		if (signal?.aborted) return { ok: false, failure: 'cancelled' };
		const msg = errMsg(e);
		return { ok: false, failure: classifyCloneError(msg), error: msg };
	}
}
