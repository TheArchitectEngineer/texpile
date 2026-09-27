// Creating the GitHub repository a project is published to. What matters is telling apart the
// answers GitHub gives, because each wants something different done: a token it does not know is
// forgotten and asked for again, one without permission is explained, a taken name is a new name.
// The bodies are GitHub's own.
import { describe, it, expect } from 'vitest';
import { createGithubRepo, githubRepoName, forkGithubRepo, parseGithubRepo } from '../../../../../../electron/src/github';
import { githubRepoOf } from '$lib/workspace/githubFork';

type Init = { method: string; headers: Record<string, string>; body: string };

function answering(status: number, body: unknown) {
	const calls: { url: string; init: Init }[] = [];
	async function fetchImpl(url: string, init: Init) {
		calls.push({ url, init });
		return { status, json: async () => body };
	}
	return { calls, fetchImpl };
}

describe('creating a repository on GitHub', () => {
	it('names it the way GitHub would, before asking', () => {
		expect(githubRepoName('  My Thesis (final) ')).toBe('My-Thesis-final-');
		expect(githubRepoName('paper_v2.1')).toBe('paper_v2.1');
	});

	it("asks for the name and visibility with the author's token, and returns where it went", async () => {
		const { calls, fetchImpl } = answering(201, {
			full_name: 'ada/thesis',
			html_url: 'https://github.com/ada/thesis',
			clone_url: 'https://github.com/ada/thesis.git'
		});
		const res = await createGithubRepo(fetchImpl, 'tok', { name: 'thesis', isPrivate: true });
		expect(res).toEqual({
			ok: true,
			repo: { fullName: 'ada/thesis', htmlUrl: 'https://github.com/ada/thesis', cloneUrl: 'https://github.com/ada/thesis.git' }
		});
		expect(calls[0].url).toBe('https://api.github.com/user/repos');
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
		expect(JSON.parse(calls[0].init.body)).toEqual({ name: 'thesis', private: true });
	});

	it('a token GitHub does not know is an authentication failure', async () => {
		const { fetchImpl } = answering(401, { message: 'Bad credentials' });
		expect(await createGithubRepo(fetchImpl, 'old', { name: 'x', isPrivate: true })).toMatchObject({ ok: false, failure: 'auth' });
	});

	it('a token that may not create repositories is a permission failure, not a bad password', async () => {
		const { fetchImpl } = answering(403, { message: 'Resource not accessible by personal access token' });
		expect(await createGithubRepo(fetchImpl, 't', { name: 'x', isPrivate: false })).toMatchObject({ ok: false, failure: 'scope' });
	});

	it('a rate limit is not mistaken for a missing permission', async () => {
		const { fetchImpl } = answering(403, { message: 'API rate limit exceeded for user ID 1.' });
		expect(await createGithubRepo(fetchImpl, 't', { name: 'x', isPrivate: false })).toMatchObject({ ok: false, failure: 'other' });
	});

	it('says when the name is taken', async () => {
		const { fetchImpl } = answering(422, {
			message: 'Repository creation failed.',
			errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }]
		});
		const res = await createGithubRepo(fetchImpl, 't', { name: 'thesis', isPrivate: true });
		expect(res).toMatchObject({ ok: false, failure: 'exists' });
		expect(!res.ok && res.error).toContain('name already exists');
	});

	it('an unreachable GitHub is a network failure', async () => {
		async function fetchImpl(): Promise<never> {
			throw new Error('net::ERR_INTERNET_DISCONNECTED');
		}
		expect(await createGithubRepo(fetchImpl, 't', { name: 'x', isPrivate: true })).toMatchObject({ ok: false, failure: 'network' });
	});

	it('will not ask for a repository with no name', async () => {
		const { calls, fetchImpl } = answering(201, {});
		expect(await createGithubRepo(fetchImpl, 't', { name: '   ', isPrivate: true })).toMatchObject({ ok: false });
		expect(calls).toHaveLength(0);
	});
});

describe('the SSH address', () => {
	it('is passed on when GitHub gives one, for publishing over SSH', async () => {
		const { fetchImpl } = answering(201, {
			full_name: 'ada/thesis',
			html_url: 'https://github.com/ada/thesis',
			clone_url: 'https://github.com/ada/thesis.git',
			ssh_url: 'git@github.com:ada/thesis.git'
		});
		const res = await createGithubRepo(fetchImpl, 'tok', { name: 'thesis', isPrivate: true });
		expect(res.ok && res.repo.sshUrl).toBe('git@github.com:ada/thesis.git');
	});
});

describe('forking a repository on GitHub', () => {
	it("asks for a fork of the remote's repository and returns the author's copy", async () => {
		const { calls, fetchImpl } = answering(202, {
			full_name: 'ada/thesis',
			html_url: 'https://github.com/ada/thesis',
			clone_url: 'https://github.com/ada/thesis.git',
			ssh_url: 'git@github.com:ada/thesis.git',
			owner: { login: 'ada' }
		});
		const res = await forkGithubRepo(fetchImpl, 'tok', 'babbage', 'thesis');
		// the SSH address too, for an author whose remote is reached over SSH
		expect(res).toEqual({
			ok: true,
			repo: {
				fullName: 'ada/thesis',
				htmlUrl: 'https://github.com/ada/thesis',
				cloneUrl: 'https://github.com/ada/thesis.git',
				sshUrl: 'git@github.com:ada/thesis.git',
				owner: 'ada'
			}
		});
		expect(calls[0].url).toBe('https://api.github.com/repos/babbage/thesis/forks');
		expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
	});

	it('tells a token GitHub does not know from one that may not fork', async () => {
		expect(await forkGithubRepo(answering(401, { message: 'Bad credentials' }).fetchImpl, 't', 'a', 'b')).toMatchObject({
			ok: false,
			failure: 'auth'
		});
		expect(await forkGithubRepo(answering(403, { message: 'Resource not accessible' }).fetchImpl, 't', 'a', 'b')).toMatchObject({
			ok: false,
			failure: 'scope'
		});
		const offline = async () => {
			throw new Error('net::ERR_INTERNET_DISCONNECTED');
		};
		expect(await forkGithubRepo(offline, 't', 'a', 'b')).toMatchObject({ ok: false, failure: 'network' });
	});

	it('finds the GitHub repository in an address, and nothing in any other', () => {
		for (const url of [
			'https://github.com/babbage/thesis.git',
			'https://github.com/babbage/thesis',
			'git@github.com:babbage/thesis.git',
			'https://ada@github.com/babbage/thesis.git'
		]) {
			expect(parseGithubRepo(url)).toEqual({ owner: 'babbage', repo: 'thesis' });
			expect(githubRepoOf(url)).toBe('babbage/thesis');
		}
		for (const url of ['https://gitlab.com/babbage/thesis.git', 'https://github.com/babbage', 'http://127.0.0.1:8765/remote.git']) {
			expect(parseGithubRepo(url)).toBeNull();
			expect(githubRepoOf(url)).toBeNull();
		}
	});
});
