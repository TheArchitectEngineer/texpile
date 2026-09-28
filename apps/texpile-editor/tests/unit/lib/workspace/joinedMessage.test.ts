// A version that Sync or Combine now makes to join this branch with its remote is named after where
// the remote is, as a person would say it, instead of git's "Merge remote-tracking branch ...".
import { it, expect, vi } from 'vitest';

const gitRemotes = vi.fn();
vi.mock('$lib/workspace/git', () => ({ gitRemotes }));

const { remotePlace, remoteOf, joinedMessage } = await import('$lib/workspace/joinedMessage');

it('names the hosts people know, and any other host by its name', () => {
	expect(remotePlace('https://github.com/ada/thesis.git', 'origin')).toBe('GitHub');
	expect(remotePlace('git@github.com:ada/thesis.git', 'origin')).toBe('GitHub');
	expect(remotePlace('ssh://git@GitLab.com/ada/thesis.git', 'origin')).toBe('GitLab');
	expect(remotePlace('https://ada@bitbucket.org/ada/thesis.git', 'origin')).toBe('Bitbucket');
	expect(remotePlace('https://git.example.ac.uk/group/paper.git', 'origin')).toBe('git.example.ac.uk');
	expect(remotePlace('http://127.0.0.1:8767/paper.git', 'origin')).toBe('127.0.0.1');
});

it('names a folder or an address it cannot read by the remote', () => {
	expect(remotePlace('/Volumes/USB/thesis.git', 'backup')).toBe('backup');
	expect(remotePlace('file:///srv/git/thesis.git', 'backup')).toBe('backup');
	expect(remotePlace('C:\\Users\\ada\\thesis.git', 'backup')).toBe('backup');
	expect(remotePlace(undefined, 'origin')).toBe('origin');
});

it('finds the remote a tracking branch belongs to, the longest name first', () => {
	expect(remoteOf('origin/main', ['origin', 'backup'])).toBe('origin');
	expect(remoteOf('team/lab/main', ['team', 'team/lab'])).toBe('team/lab');
	expect(remoteOf('elsewhere/main', ['origin'])).toBeNull();
});

it("leaves git's own message when there is nowhere to name", async () => {
	expect(await joinedMessage('/p', null)).toBe('');
	gitRemotes.mockResolvedValueOnce({ ok: true, remotes: [{ name: 'origin', url: 'https://github.com/ada/thesis.git' }] });
	expect(await joinedMessage('/p', 'origin/main')).toBe('Joined with the versions on GitHub');
	gitRemotes.mockResolvedValueOnce({ ok: false });
	expect(await joinedMessage('/p', 'origin/main')).toBe('');
});
