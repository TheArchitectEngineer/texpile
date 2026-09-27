// The Source Control panel's history half: the version list, what differs from a version now, a
// file as it was in one, and Restore. Split from gitService.ts, whose repo-root resolution and
// command factory it shares; the helper process serves both (helper/helperWorker.ts).
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { milestonesByCommit, type GitMilestone } from './gitTags';
import { git, isMissingGit, errMsg, resolveRepoRoot, toRepoRel, markGitMissing, type GitShowResult, type GitOpResult } from './gitService';

// ── history ────────────────────────────────────────────────────────────────────

/** by absolute path; status narrowed to the letters a badge exists for. A rename carries the
 *  name it had before in `from`. */
export type GitFileChange = { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string };

export type GitLogEntry = {
	/** names on this version (annotated tags): 'Sent to the committee' */
	milestones?: GitMilestone[];
	hash: string;
	/** abbreviated hash, as git chose to abbreviate it */
	short: string;
	subject: string;
	/** the rest of the message after its first line, when it has more */
	body?: string;
	/** in one file's log: the file's path in this version, absolute, when it was named differently */
	path?: string;
	author: string;
	/** author date, ISO 8601 */
	date: string;
	/** two or more is a merge, which the rail has to mark: git log flattens a branching history
	 *  into one date-ordered list and the lane through it claims a succession that is not there */
	parentCount: number;
};

export type GitLogResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
	error?: string;
	entries?: GitLogEntry[];
	/** the history is longer than what was asked for, so `entries` is the newest slice of it */
	hasMore?: boolean;
};

// the only two bytes git will not emit inside a subject or an author name
const REC = '\x00';
const FIELD = '\x1f';
// between a message's first line and the rest of it
const BODY = '\x1e';

// The same bytes as git's own escapes, for the ARGUMENT side: argv is NUL-terminated, so a
// literal NUL there makes Node refuse to spawn - it throws before git runs, and every call comes
// back failed, which reads in the panel as a repo nobody has committed to.
const REC_FMT = '%x00';
const FIELD_FMT = '%x1f';
const BODY_FMT = '%x1e';

/** exported for the tests: the delimiters are the whole reason this parses */
export function parseGitLog(raw: string): GitLogEntry[] {
	const entries: GitLogEntry[] = [];
	for (const chunk of raw.split(REC)) {
		if (!chunk.trim()) continue;
		const [hash, short, author, date, parents, ...rest] = chunk.trim().split(FIELD);
		// the message last, so a separator in it cannot shift the fields before it
		const [subject, ...bodyParts] = rest.join(FIELD).split(BODY);
		if (!hash) continue;
		entries.push({
			hash,
			short: short ?? '',
			author: author ?? '',
			date: date ?? '',
			// %P is space-separated, and empty for a root commit
			parentCount: (parents ?? '').trim() ? (parents ?? '').trim().split(/\s+/).length : 0,
			subject: (subject ?? '').trim(),
			// only when there is one: most versions are a single line
			...(bodyParts.join(BODY).trim() ? { body: bodyParts.join(BODY).trim() } : {})
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
		else if (letter === 'R') out.push({ path, status: 'R', from: paths[0].trim() });
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
			`--format=${REC_FMT}%H${FIELD_FMT}%h${FIELD_FMT}%an${FIELD_FMT}%aI${FIELD_FMT}%P${FIELD_FMT}%s${BODY_FMT}%b`,
			...(rel ? ['--', rel] : [])
		]);
		const all = parseGitLog(raw);
		// a tag listing that fails costs the badges, never the history
		const marks = await milestonesByCommit(rr.root).catch(() => ({}) as Record<string, GitMilestone[]>);
		const entries = all.slice(0, want).map((e) => (marks[e.hash] ? { ...e, milestones: marks[e.hash] } : e));
		return { ok: true, entries, hasMore: all.length > want };
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

/**
 * `git log -z --format=%x01%H --name-only` → each version's hash and the file's name in it,
 * repo-relative. -z so a name outside ASCII (a chapter called 章.tex) comes through as it is, not
 * as git's quoted octal. A version that lists no name (a merge) is left out.
 */
export function parseFileNames(raw: string): Map<string, string> {
	const out = new Map<string, string>();
	let hash = '';
	for (const token of raw.split('\0')) {
		if (token.startsWith('\x01')) hash = token.slice(1).trim();
		else if (hash && token.replace(/^\n/, '') && !out.has(hash)) out.set(hash, token.replace(/^\n/, ''));
	}
	return out;
}

/** One file's versions, newest first, following it across renames: the git half of the Timeline
 *  (VS Code's Git History timeline source, `git log --follow -- <file>`). */
export async function gitFileLog(workspaceRoot: string, path: string, limit = 50): Promise<GitLogResult> {
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	const root = rr.root;
	const [rel] = toRepoRel(root, [path]);
	if (!rel || rel.startsWith('..')) return { ok: true, entries: [] };
	const max = `--max-count=${Math.max(1, Math.min(limit, 200))}`;
	try {
		const raw = await git(root).raw([
			'log',
			'--follow',
			max,
			`--format=${REC_FMT}%H${FIELD_FMT}%h${FIELD_FMT}%an${FIELD_FMT}%aI${FIELD_FMT}%P${FIELD_FMT}%s${BODY_FMT}%b`,
			'--',
			rel
		]);
		// --follow reaches back past renames, where the file had another name: each version carries
		// the name it had then, or a comparison would look up a path that version never held
		const nameAt = parseFileNames(await git(root).raw(['log', '--follow', '-z', max, '--format=%x01%H', '--name-only', '--', rel]));
		return { ok: true, entries: withNamesThen(parseGitLog(raw), nameAt, rel, root) };
	} catch (e) {
		if (isMissingGit(e)) return { ok: false, reason: 'no-git' };
		// an unborn HEAD, or a file git has never seen: no versions, which is not a failure
		if (/does not have any commits yet|unknown revision|bad revision/i.test(errMsg(e))) return { ok: true, entries: [] };
		return { ok: false, error: errMsg(e) };
	}
}

/** `path` on each version where the file was named other than `rel`. A version git lists no name
 *  for (a merge) had the name of the version before it, so names are carried oldest to newest. */
function withNamesThen(entries: GitLogEntry[], nameAt: Map<string, string>, rel: string, root: string): GitLogEntry[] {
	let then = rel;
	const named = [...entries].reverse().map((e) => {
		then = nameAt.get(e.hash) ?? then;
		return then === rel ? e : { ...e, path: resolve(root, then) };
	});
	return named.reverse();
}

export type GitChangesResult = {
	ok: boolean;
	reason?: 'not-a-repo' | 'no-git' | 'unsafe';
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
		return { ok: true, entries: insideFolder(rr.root, workspaceRoot, parseNameStatus(raw)) };
	} catch (e) {
		if (isMissingGit(e)) {
			markGitMissing();
			return { ok: false, reason: 'no-git' };
		}
		return { ok: false, error: errMsg(e) };
	}
}

/** A revision from the window: a commit hash or HEAD, perhaps with a parent step. Anything else is
 *  refused before it reaches git, above all something starting with '-', which `git show` would
 *  take as an option (`--output=<path>` writes a file). Exported for the tests. */
export function isShowableRef(ref: string): boolean {
	return /^(HEAD|[0-9a-f]{4,64})(\^[0-9]?|~[0-9]{1,4})?$/i.test(ref);
}

/** the file at `ref` in the repository at `root`; '' where it did not exist then */
async function showFile(root: string, absPath: string, ref: string): Promise<GitShowResult> {
	try {
		const [rel] = toRepoRel(root, [absPath]);
		return { ok: true, hasHead: true, content: await git(root).show([`${ref}:${rel}`]) };
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

/** a file's contents at an arbitrary commit, for diffing a version against the working copy. */
export async function gitShowAt(absPath: string, ref: string): Promise<GitShowResult> {
	if (!absPath) return { ok: false, hasHead: false, error: 'Missing path' };
	if (!isShowableRef(ref)) return { ok: false, hasHead: false, error: 'Invalid revision' };
	const rr = await resolveRepoRoot(dirname(absPath));
	if (!rr.root) return { ok: false, hasHead: false, reason: rr.reason };
	return showFile(rr.root, absPath, ref);
}

/** the repo-relative paths git printed, as absolute paths, keeping only those inside the folder */
function insideFolder(repoRoot: string, workspaceRoot: string, changes: GitFileChange[]): GitFileChange[] {
	const wsAbs = resolve(workspaceRoot);
	return changes
		.map((f) => ({ ...f, path: resolve(repoRoot, f.path), ...(f.from ? { from: resolve(repoRoot, f.from) } : {}) }))
		.filter((f) => {
			const inside = relative(wsAbs, f.path);
			return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
		});
}

export type GitVersionChangesResult = GitChangesResult & {
	/** what the version is compared with: its first parent, or null for a project's first version */
	parent?: string | null;
};

/**
 * What one version itself changed, against the version before it: the commit view VS Code and
 * GitHub show, next to the "what differs from now" a version opens to in the panel. A merge is
 * read against its first parent, so it lists what the merge brought in.
 */
export async function gitChangesIn(workspaceRoot: string, hash: string): Promise<GitVersionChangesResult> {
	if (!/^[0-9a-f]{4,64}$/i.test(hash)) return { ok: false, error: 'Invalid revision' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, reason: rr.reason };
	try {
		const g = git(rr.root);
		const [rel] = toRepoRel(rr.root, [workspaceRoot]);
		const scope = rel ? ['--', rel] : [];
		// with -q a missing parent prints nothing and exits 1, which simple-git resolves as ''
		const parent = (await g.raw(['rev-parse', '--verify', '-q', `${hash}^1`])).trim() || null;
		const raw = parent
			? await g.raw(['diff', '--name-status', '-M', parent, hash, ...scope])
			: await g.raw(['diff-tree', '--root', '-r', '-M', '--no-commit-id', '--name-status', hash, ...scope]);
		return { ok: true, parent, entries: insideFolder(rr.root, workspaceRoot, parseNameStatus(raw)) };
	} catch (e) {
		if (isMissingGit(e)) {
			markGitMissing();
			return { ok: false, reason: 'no-git' };
		}
		return { ok: false, error: errMsg(e) };
	}
}

/** A file as it was at `ref`, found through the project folder rather than the file's own: a file
 *  in a folder deleted since has no directory left to find its repository from. */
export async function gitFileAt(workspaceRoot: string, absPath: string, ref: string): Promise<GitShowResult> {
	if (!absPath) return { ok: false, hasHead: false, error: 'Missing path' };
	if (!isShowableRef(ref)) return { ok: false, hasHead: false, error: 'Invalid revision' };
	const rr = await resolveRepoRoot(workspaceRoot);
	if (!rr.root) return { ok: false, hasHead: false, reason: rr.reason };
	return showFile(rr.root, absPath, ref);
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
