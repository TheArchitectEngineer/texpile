// Removing a milestone removes it from the remote too, for everyone who syncs with it: it is asked
// first, as VS Code asks before deleting a remote tag.
import { it, expect, vi } from 'vitest';

const gitRemoveMilestone = vi.fn(async (_root: string, _name: string) => ({ ok: true }));
const confirmAsk = vi.fn(async (_message: string, _opts?: { confirmLabel?: string }) => false);

vi.mock('$lib/workspace/gitMilestones', () => ({ gitMarkMilestone: vi.fn(), gitRemoveMilestone }));
vi.mock('$lib/modals/confirm.svelte', () => ({ confirmAsk }));
vi.mock('$lib/modals/toaster-svelte', () => ({ toaster: { success: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/workspace/gitStore', () => ({ refreshGitHistory: vi.fn() }));
vi.mock('$lib/workspace/workspaceStore', () => ({ workspaceRoot: { current: '/p' } }));

const { ScmMilestones } = await import('$lib/workspace/scmMilestones.svelte');

it('asks before removing a milestone, and leaves it on no', async () => {
	const milestones = new ScmMilestones({ busy: false });
	await milestones.remove('sent-to-committee', 'Sent to the committee');
	expect(confirmAsk.mock.calls[0][0]).toContain('Sent to the committee');
	expect(gitRemoveMilestone).not.toHaveBeenCalled();

	confirmAsk.mockResolvedValueOnce(true);
	await milestones.remove('sent-to-committee', 'Sent to the committee');
	expect(gitRemoveMilestone).toHaveBeenCalledWith('/p', 'sent-to-committee');
});
