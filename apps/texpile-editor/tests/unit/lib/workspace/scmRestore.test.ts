// The panel hands the restore action a whole log entry, and it used to take a hash and a subject
// instead - so the entry arrived where the hash belonged and the subject was undefined. The dialog
// read `Restore "undefined"?` and the hash git received was an object.
//
// Types cannot catch this: the prop travels through `scm: Any` in WorkspaceChrome, which erases
// the signature all the way from the panel to here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// the parameters are spelled out so the assertions below can read mock.calls without TS deciding
// these take none
const gitRestore = vi.fn(async (_root: string, _hash: string, _message: string) => ({ ok: true }));
const gitCommit = vi.fn(async (_root: string, _message: string) => ({ ok: true }));
const gitStage = vi.fn(async (_root: string, _paths: string[]) => ({ ok: true }));
const gitUnstage = vi.fn(async (_root: string, _paths: string[]) => ({ ok: true }));
const confirmAsk = vi.fn(async (_message: string, _opts?: { confirmLabel?: string }) => true);
const gitIdentity = vi.fn(async (_root: string) => ({ name: 'Ada Lovelace' as string | null, email: 'ada@example.com' as string | null }));
const askIdentity = vi.fn(async (_current: { name: string; email: string }) => null as { name: string; email: string } | null);
const gitChanges = { current: [] as { path: string; x: string; y: string }[] };

vi.mock('$lib/workspace/git', () => ({
	gitInit: vi.fn(),
	gitStage,
	gitUnstage,
	gitDiscard: vi.fn(),
	gitCommit,
	gitRestore,
	gitChangesSince: vi.fn(),
	gitPush: vi.fn(),
	// someone git already knows, unless a test says otherwise
	gitIdentity,
	gitSetIdentity: vi.fn(async () => ({ ok: true }))
}));
vi.mock('$lib/workspace/gitDialogs.svelte', () => ({ askIdentity, askPublish: vi.fn() }));
vi.mock('$lib/modals/confirm.svelte', () => ({ confirmAsk }));
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/workspace/gitStore', () => ({
	refreshGitStatus: vi.fn(),
	refreshGitHistory: vi.fn(),
	isGitRepo: { current: true },
	gitChanges,
	gitOperation: { current: null },
	setGitWriting: vi.fn()
}));
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: 'C:/project' }, isDirty: { current: false } }));

const { ScmActions } = await import('$lib/workspace/scmActions.svelte');

const flushed = vi.fn(async () => {});
const discarded = vi.fn();

function makeScm(opts: { pending?: boolean } = {}) {
	return new ScmActions({
		getLoadedPath: () => null,
		discardPendingSave: discarded,
		hasPendingSave: () => opts.pending ?? false,
		flushPendingSave: flushed,
		deleteEntry: async () => {},
		refreshTree: async () => {},
		loadFile: async () => {},
		captureDiffSnapshot: () => {},
		isDiffMode: () => false,
		openCompareTab: () => {},
		ignoreLines: () => [],
		writeText: async () => {},
		readTextIfPresent: async () => null
	});
}

const ENTRY = { hash: '9f3c1ab0', subject: 'Add the methods section' };

describe('restoring a version', () => {
	beforeEach(() => {
		gitRestore.mockClear();
		confirmAsk.mockClear();
	});

	it('names the version in the confirmation, rather than "undefined"', async () => {
		await makeScm().restore(ENTRY);
		const asked = String(confirmAsk.mock.calls[0]?.[0] ?? '');
		expect(asked).toContain(ENTRY.subject);
		expect(asked).not.toContain('undefined');
	});

	it('gives git the hash, not the entry it came in', async () => {
		await makeScm().restore(ENTRY);
		const [, hash, message] = gitRestore.mock.calls[0] as unknown as [string, string, string];
		expect(hash).toBe(ENTRY.hash);
		expect(message).toContain(ENTRY.subject);
	});

	it('does nothing when the confirmation is declined', async () => {
		confirmAsk.mockResolvedValueOnce(false as never);
		expect(await makeScm().restore(ENTRY)).toBe(false);
		expect(gitRestore).not.toHaveBeenCalled();
	});
});

// The restore itself refuses on a dirty tree, so work already saved was never at risk. The edit
// still sitting in the buffer WAS: git cannot see it, and it used to be discarded outright.
describe('work that would be in the way', () => {
	beforeEach(() => {
		gitRestore.mockClear();
		gitCommit.mockClear();
		gitStage.mockClear();
		confirmAsk.mockClear();
		flushed.mockClear();
		discarded.mockClear();
		gitChanges.current = [];
	});

	it('is saved as its own version first, so it can be gone back to as well', async () => {
		gitChanges.current = [{ path: 'C:/project/main.tex', x: ' ', y: 'M' }];
		await makeScm().restore(ENTRY);

		expect(gitStage.mock.calls[0]?.[1]).toEqual(['C:/project/main.tex']);
		expect(gitCommit).toHaveBeenCalled();
		expect(gitRestore).toHaveBeenCalled();
	});

	it('counts the edit that never reached disk, and writes it out rather than dropping it', async () => {
		await makeScm({ pending: true }).restore(ENTRY);
		expect(flushed).toHaveBeenCalled();
		expect(discarded).not.toHaveBeenCalled();
	});

	it('writes nothing when the answer is no, so a cancelled restore has no side effect', async () => {
		confirmAsk.mockResolvedValueOnce(false as never);
		await makeScm({ pending: true }).restore(ENTRY);
		expect(flushed).not.toHaveBeenCalled();
		expect(gitCommit).not.toHaveBeenCalled();
	});

	// gitRestore checks --untracked-files=no, so these neither block it nor belong in a version
	// the user never chose to track
	it('leaves untracked files alone', async () => {
		gitChanges.current = [{ path: 'C:/project/scratch.txt', x: '?', y: '?' }];
		await makeScm().restore(ENTRY);

		expect(gitCommit).not.toHaveBeenCalled();
		expect(gitRestore).toHaveBeenCalled();
	});

	it('asks the plain question when there is nothing in the way', async () => {
		await makeScm().restore(ENTRY);
		expect(String(confirmAsk.mock.calls[0]?.[0] ?? '')).toContain('undo');
		expect(gitCommit).not.toHaveBeenCalled();
	});
});

// git refuses to write a version it cannot put a name and email on. Save version asked; Restore on
// a clean tree went straight to a commit, and so could fail with git's own "tell me who you are".
describe('who the version is by', () => {
	beforeEach(() => {
		gitRestore.mockClear();
		gitCommit.mockClear();
		askIdentity.mockClear();
		confirmAsk.mockClear();
		gitChanges.current = [];
	});

	it('restore asks for a name and email git does not have, and stops if the author backs out', async () => {
		gitIdentity.mockResolvedValueOnce({ name: null, email: null });
		expect(await makeScm().restore(ENTRY)).toBe(false);
		expect(askIdentity).toHaveBeenCalled();
		expect(gitRestore).not.toHaveBeenCalled();
	});

	it('does not ask when git already knows', async () => {
		await makeScm().restore(ENTRY);
		expect(askIdentity).not.toHaveBeenCalled();
		expect(gitRestore).toHaveBeenCalled();
	});
});

describe('saving a version', () => {
	beforeEach(() => {
		flushed.mockClear();
		gitStage.mockClear();
		gitCommit.mockClear();
	});

	// with autosave's delay (or autosave off) the last edit is not on disk yet, and the version
	// would quietly leave it behind
	it('writes out an edit still waiting to be saved before building the version', async () => {
		const order: string[] = [];
		flushed.mockImplementationOnce(async () => void order.push('flush'));
		gitStage.mockImplementationOnce(async () => (order.push('stage'), { ok: true }));
		expect(await makeScm({ pending: true }).commit('Tighten the proof', ['C:/project/main.tex'])).toBe(true);
		expect(order).toEqual(['flush', 'stage']);
	});

	it('writes nothing when nothing is waiting', async () => {
		await makeScm().commit('Tighten the proof', ['C:/project/main.tex']);
		expect(flushed).not.toHaveBeenCalled();
		expect(gitCommit).toHaveBeenCalled();
	});
});
