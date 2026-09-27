/** @vitest-environment jsdom */
// VS Code's autofetch loop, as the automatic check copies it: wait until git is idle and the window
// is in front, fetch without asking anyone anything, say so once per new arrival, and stop at a
// check that would have needed a sign-in until the author's own Sync works.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Res = { ok: boolean; failure?: string; remote?: string; behind?: number };
const gitFetchQuiet = vi.fn(async (_root: string): Promise<Res> => ({ ok: true, remote: 'origin', behind: 0 }));
const info = vi.fn();
const settings = { current: { checkForNewVersions: true } };

vi.mock('$lib/workspace/fileSystem', () => ({ nativeBridge: () => ({ gitFetchQuiet }) }));
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/p' } }));
vi.mock('$lib/workspace/gitStore', () => ({
	refreshGitStatus: vi.fn(async () => ({})),
	gitRunning: { current: null },
	gitTracking: { current: 'origin/main' },
	gitOperation: { current: null },
	isGitRepo: { current: true }
}));
vi.mock('$lib/settings', () => ({ settings }));
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster: { info } }));

const { AutoCheck, AUTO_CHECK_PERIOD_MS, resumeAutoCheck } = await import('$lib/workspace/scmAutoCheck.svelte');

let check: InstanceType<typeof AutoCheck>;
const sync = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(document, 'hasFocus').mockReturnValue(true);
	gitFetchQuiet.mockClear();
	info.mockClear();
	settings.current.checkForNewVersions = true;
	resumeAutoCheck();
	check = new AutoCheck({ isBusy: () => false, sync });
});
afterEach(() => {
	check.stop();
	vi.useRealTimers();
});

describe('the automatic check', () => {
	it('checks soon after the project opens, then every three minutes, and says once when versions arrive', async () => {
		gitFetchQuiet.mockResolvedValueOnce({ ok: true, remote: 'origin', behind: 2 });
		check.start();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(gitFetchQuiet).toHaveBeenCalledWith('/p');
		expect(info).toHaveBeenCalledTimes(1);
		expect(info.mock.calls[0][0].title).toContain('2');
		// the notice's button syncs
		info.mock.calls[0][0].action.onClick();
		expect(sync).toHaveBeenCalled();

		// the same two, still not synced: nothing more is said
		gitFetchQuiet.mockResolvedValueOnce({ ok: true, remote: 'origin', behind: 2 });
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(2);
		expect(info).toHaveBeenCalledTimes(1);

		gitFetchQuiet.mockResolvedValueOnce({ ok: true, remote: 'origin', behind: 3 });
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS);
		expect(info).toHaveBeenCalledTimes(2);
	});

	it('stops at a check that would have had to ask for a sign-in, until a Sync of the author works', async () => {
		gitFetchQuiet.mockResolvedValueOnce({ ok: false, failure: 'cancelled' });
		check.start();
		await vi.advanceTimersByTimeAsync(5_000);
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS * 3);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(1);

		resumeAutoCheck();
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(2);
	});

	it('waits while the window is behind others, and checks on coming back', async () => {
		vi.mocked(document.hasFocus).mockReturnValue(false);
		check.start();
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS * 2);
		expect(gitFetchQuiet).not.toHaveBeenCalled();
		vi.mocked(document.hasFocus).mockReturnValue(true);
		window.dispatchEvent(new Event('focus'));
		await vi.advanceTimersByTimeAsync(0);
		expect(gitFetchQuiet).toHaveBeenCalledTimes(1);
	});

	it('does nothing when turned off in Preferences', async () => {
		settings.current.checkForNewVersions = false;
		check.start();
		await vi.advanceTimersByTimeAsync(AUTO_CHECK_PERIOD_MS * 2);
		expect(gitFetchQuiet).not.toHaveBeenCalled();
	});
});
