// A refused upload to someone else's GitHub repository offers a fork; anywhere else it does not.
import { it, expect, vi, beforeEach } from 'vitest';

const remotes = { list: [{ name: 'origin', url: 'https://github.com/babbage/thesis.git' }] };
const promptAsk = vi.fn(async (_o: unknown) => 'fork' as string | null);
const githubFork = vi.fn(
	async (_root: string, _remote: string) => ({ ok: true, fullName: 'ada/thesis', url: 'https://github.com/ada/thesis' }) as object
);
const toaster = { success: vi.fn(), error: vi.fn() };

vi.mock('$lib/workspace/git', () => ({ gitRemotes: async () => ({ ok: true, remotes: remotes.list }) }));
vi.mock('$lib/workspace/githubFork', async (orig) => ({ ...(await orig<typeof import('$lib/workspace/githubFork')>()), githubFork }));
vi.mock('$lib/workspace/gitStore', () => ({ refreshGitStatus: vi.fn() }));
vi.mock('$lib/modals/confirm.svelte', () => ({ promptAsk }));
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster }));

const { offerFork } = await import('$lib/workspace/scmFork.svelte');

beforeEach(() => {
	vi.clearAllMocks();
	remotes.list = [{ name: 'origin', url: 'https://github.com/babbage/thesis.git' }];
});

it('names the repository, and on yes forks and uploads to the fork', async () => {
	expect(await offerFork('/p', 'origin')).toBe(true);
	expect((promptAsk.mock.calls[0][0] as { message: string }).message).toContain('babbage/thesis');
	expect(githubFork).toHaveBeenCalledWith('/p', 'origin');
	expect(toaster.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Uploaded to your fork ada/thesis' }));
});

it('takes no for an answer', async () => {
	promptAsk.mockResolvedValueOnce('cancel');
	expect(await offerFork('/p', 'origin')).toBe(true);
	expect(githubFork).not.toHaveBeenCalled();
});

it('offers nothing for a repository that is not on GitHub', async () => {
	remotes.list = [{ name: 'origin', url: 'https://gitlab.com/babbage/thesis.git' }];
	expect(await offerFork('/p', 'origin')).toBe(false);
	expect(await offerFork('/p', undefined)).toBe(false);
	expect(promptAsk).not.toHaveBeenCalled();
});

it('says why a fork did not work', async () => {
	githubFork.mockResolvedValueOnce({ ok: false, failure: 'scope' });
	await offerFork('/p', 'origin');
	expect(toaster.error).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('repo scope') }));
});
