// The Source Control panel's history half: the version list, what differs from a version now, a
// file as it was in one, and Restore. Split from gitService.ts, whose repo-root resolution and
// command factory it shares; the helper process serves both (helper/helperWorker.ts).
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { git, isMissingGit, errMsg, resolveRepoRoot, toRepoRel, markGitMissing, type GitShowResult, type GitOpResult } from './gitService';

// ── history ────────────────────────────────────────────────────────────────────

/** by absolute path; status narrowed to the letters a badge exists for */
export type GitFileChange = { path: string; status: 'A' | 'M' | 'D' | 'R' };

export type GitLogEntry = {
	hash: string;
	/** abbreviated hash, as git chose to abbreviate it */
	short: string;
	subject: string;
	author: string;
	/** author date, ISO 8601 */
	date: string;
	/** two or more is a merge, which the rail has to mark: git log flattens a branching history
	 *  into one date-ordered list and the lane through it claims a succession that is not there */
	parentCount: number;
};

export type GitLogResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git';
	error?: string;
	entries?: GitLogEntry[];
	/** the history is longer than what was asked for, so `entries` is the newest slice of it */
	hasMore?: boolean;
};

// the only two bytes git will not emit inside a subject or an author name
const REC = '\x00';
const FIELD = '\x1f';

// The same bytes as git's own escapes, for the ARGUMENT side: argv is NUL-terminated, so a
// literal NUL there makes Node refuse to spawn - it throws before git runs, and every call comes
// back failed, which reads in the panel as a repo nobody has committed to.
const REC_FMT = '%x00';
const FIELD_FMT = '%x1f';

/** exported for the tests: the delimiters are the whole reason this parses */
export function parseGitLog(raw: string): GitLogEntry[] {
	const entries: GitLogEntry[] = [];
	for (const chunk of raw.split(REC)) {
		if (!chunk.trim()) continue;
		const [hash, short, author, date, parents, ...subjectParts] = chunk.trim().split(FIELD);
		if (!hash) continue;
		entries.push({
			hash,
			short: short ?? '',
			author: author ?? '',
			date: date ?? '',
			// %P is space-separated, and empty for a root commit
			parentCount: (parents ?? '').trim() ? (parents ?? '').trim().split(/\s+/).length : 0,
			subject: subjectParts.join(FIELD).trim()
		});
	}
	return entries;
}

/** a letter, a tab, a path - or two paths when it is a rename. Repo-relative, as git printed them. */
export function parseNameStatus(raw: string): GitFileChange[] {
	const out: GitFileChange[] = [];
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		const [code, ...paths] = line.split('\t');
		if (!code || !paths.length) continue;
		// R and C carry a similarity score (R100)
		const letter = code[0].toUpperCase();
		// old then new; the new one is what exists to open
		const path = paths[paths.length - 1].trim();
		if (!path) continue;
		if (letter === 'D') out.push({ path, status: 'D' });
		else if (letter === 'R') out.push({ path, status: 'R' });
		else if (letter === 'A' || letter === 'C') out.push({ path, status: 'A' });
		else out.push({ path, status: 'M' });
	}
	return out;
}

/** Newest first, scoped to the workspace subtree. Asks for one more than it returns - that is
 *  how hasMore is known - because a truncated list reads as the project's first version. */
export async function gitLog(workspaceRoot: string, limit = 100): Promise<GitLogResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const want = Math.max(1, Math.min(limit, 2000));
	try {
		// repo-relative and forward-slashed, or a Windows path matches nothing and the history comes
		// back silently empty. Empty means the workspace IS the root, where a pathspec would narrow it.
		const [rel] = toRepoRel(rr.root, [workspaceRoot]);
		const raw = await git(rr.root).raw([
			'log',
			`--max-count=${want + 1}`,
			`--format=${REC_FMT}%H${FIELD_FMT}%h${FIELD_FMT}%an${FIELD_FMT}%aI${FIELD_FMT}%P${FIELD_FMT}%s`,
			...(rel ? ['--', rel] : [])
		]);
		const all = parseGitLog(raw);
		return { ok: true, entries: all.slice(0, want), hasMore: all.length > want };
	} catch (e) {
		if (isMissingGit(e)) {
			markGitMissing();
			return { ok: false, reason: 'no-git' };
		}
		// an unborn HEAD has no log, which is a valid empty history rather than a failure
		if (/does not have any commits yet|unknown revision|bad revision/i.test(errMsg(e))) return { ok: true, entries: [] };
		return { ok: false, error: errMsg(e) };
	}
}

export type GitChangesResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git';
	error?: string;
	entries?: GitFileChange[];
};

/** What differs from a version NOW, not what it changed: every row then opens a diff with
 *  something in it. Untracked files are absent by design - they postdate every version. */
export async function gitChangesSince(workspaceRoot: string, hash: string): Promise<GitChangesResult> {
	if (!hash) return { ok: false, error: 'Missing revision' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	try {
		const [rel] = toRepoRel(rr.root, [workspaceRoot]);
		// `diff <commit>` is commit -> working tree, so the letters read as "since that version":
		// A is a file that did not exist then, D one that has gone since
		const raw = await git(rr.root).raw(['diff', '--name-status', hash, ...(rel ? ['--', rel] : [])]);
		// git prints from the REPO root; the renderer deals only in absolute paths inside the folder
		const wsAbs = resolve(workspaceRoot);
		const entries = parseNameStatus(raw)
			.map((f) => ({ ...f, path: resolve(rr.root as string, f.path) }))
			.filter((f) => {
				const inside = relative(wsAbs, f.path);
				return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
			});
		return { ok: true, entries };
	} catch (e) {
		if (isMissingGit(e)) {
			markGitMissing();
			return { ok: false, reason: 'no-git' };
		}
		return { ok: false, error: errMsg(e) };
	}
}

/** a file's contents at an arbitrary commit, for diffing a version against the working copy. */
export async function gitShowAt(absPath: string, ref: string): Promise<GitShowResult> {
	if (!absPath) return { ok: false, hasHead: false, error: 'Missing path' };
	if (!ref) return { ok: false, hasHead: false, error: 'Missing revision' };
	const rr = await resolveRepoRoot(dirname(absPath));
	if (!rr.root) return { ok: false, hasHead: false, reason: rr.reason };
	try {
		const [rel] = toRepoRel(rr.root, [absPath]);
		const content = await git(rr.root).show([`${ref}:${rel}`]);
		return { ok: true, hasHead: true, content };
	} catch (e) {
		if (isMissingGit(e)) {
			markGitMissing();
			return { ok: false, hasHead: false, reason: 'no-git' };
		}
		const msg = errMsg(e);
		// the file simply did not exist at that revision: an empty baseline, not an error
		if (/exists on disk, but not in|does not exist in|unknown revision|bad revision|invalid object name|ambiguous argument/i.test(msg)) {
			return { ok: true, hasHead: false, content: '' };
		}
		return { ok: false, hasHead: false, error: msg };
	}
}

/**
 * Roll the workspace back to `hash` by writing that version FORWARD as a new commit, so the
 * restore is itself an ordinary history entry and can be undone by restoring the one above it.
 * Nothing is ever rewound out of existence and no reset is involved.
 *
 * Refuses while the tree is dirty: overwriting uncommitted work is the one way this could lose
 * something git could not give back, so the caller saves a version first.
 */
export async function gitRestore(workspaceRoot: string, hash: string, message: string): Promise<GitOpResult> {
	if (!hash) return { ok: false, error: 'Missing revision' };
	if (!message || !message.trim()) return { ok: false, error: 'A message is required' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const repoRoot = rr.root;
	try {
		const g = git(repoRoot);
		const dirty = await g.status(['--untracked-files=no']);
		if (dirty.files.length) return { ok: false, error: 'Save a version first: there are unsaved changes.' };

		// repo-relative and forward-slashed, for the same reason as in gitLog: a backslashed
		// absolute pathspec matches nothing and the restore would find no files to change
		const [scope] = toRepoRel(repoRoot, [workspaceRoot]);
		// every path that differs between the target and now, so files ADDED since the target are
		// found too. Without this pass they would survive the restore and the result would be a
		// version that never existed.
		// --no-renames: a rename is otherwise listed by its new name only, so the restore removed the
		// new file and never brought back the old one, and the file was simply gone
		const changed = (await g.raw(['diff', '--name-only', '--no-renames', hash, 'HEAD', ...(scope ? ['--', scope] : [])]))
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		if (!changed.length) return { ok: false, error: 'That version matches the current one.' };

		for (const rel of changed) {
			try {
				await g.raw(['checkout', hash, '--', rel]);
			} catch {
				// absent at the target revision: it was added afterwards, so restoring means removing it
				await g.raw(['rm', '-f', '--ignore-unmatch', '--', rel]);
			}
		}
		await g.commit(message);
		return { ok: true };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		return { ok: false, error: errMsg(e) };
	}
}
