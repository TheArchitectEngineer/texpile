// The one GitHub API call Texpile makes: create a repository to publish a project to. No Electron
// in here, so the tests can hand it a fetch of their own.

export type GithubFailure = 'auth' | 'exists' | 'scope' | 'network' | 'other';

export type GithubRepo = {
	/** owner/name */
	fullName: string;
	/** the repository's page */
	htmlUrl: string;
	/** the https address git pushes to */
	cloneUrl: string;
	/** the SSH address, for someone whose GitHub account has their key */
	sshUrl?: string;
};

export type GithubCreateResult = { ok: true; repo: GithubRepo } | { ok: false; failure: GithubFailure; error?: string };

type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{
	status: number;
	json(): Promise<unknown>;
}>;

/** GitHub keeps letters, digits, '.', '-' and '_' and turns the rest into '-'; doing the same here
 *  means the name shown before publishing is the name the repository gets. */
export function githubRepoName(value: string): string {
	return value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-');
}

/** GitHub's own message, which for a 422 says what was wrong with the name */
function messageOf(body: unknown): string | undefined {
	if (!body || typeof body !== 'object') return undefined;
	const b = body as { message?: unknown; errors?: { message?: unknown }[] };
	const detail = Array.isArray(b.errors) ? b.errors.map((e) => (typeof e?.message === 'string' ? e.message : '')).filter(Boolean) : [];
	const head = typeof b.message === 'string' ? b.message : '';
	return [head, ...detail].filter(Boolean).join(': ') || undefined;
}

/**
 * Create `name` under the account `token` belongs to. The token is the password half of the
 * credential git uses for github.com, so a classic token needs the `repo` scope (or `public_repo`
 * for a public repository) and a fine-grained one the Administration permission.
 */
export async function createGithubRepo(
	fetchImpl: FetchLike,
	token: string,
	opts: { name: string; isPrivate: boolean }
): Promise<GithubCreateResult> {
	const name = githubRepoName(opts.name);
	if (!name) return { ok: false, failure: 'other', error: 'The repository needs a name.' };
	let res: Awaited<ReturnType<FetchLike>>;
	try {
		res = await fetchImpl('https://api.github.com/user/repos', {
			method: 'POST',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'Texpile',
				'X-GitHub-Api-Version': '2022-11-28'
			},
			body: JSON.stringify({ name, private: opts.isPrivate })
		});
	} catch (e) {
		return { ok: false, failure: 'network', error: e instanceof Error ? e.message : String(e) };
	}
	const body: unknown = await res.json().catch(() => null);
	if (res.status === 201 && body && typeof body === 'object') {
		const b = body as { full_name?: unknown; html_url?: unknown; clone_url?: unknown; ssh_url?: unknown };
		if (typeof b.full_name === 'string' && typeof b.html_url === 'string' && typeof b.clone_url === 'string') {
			const repo: GithubRepo = { fullName: b.full_name, htmlUrl: b.html_url, cloneUrl: b.clone_url };
			if (typeof b.ssh_url === 'string') repo.sshUrl = b.ssh_url;
			return { ok: true, repo };
		}
		return { ok: false, failure: 'other', error: 'GitHub created the repository but did not say where.' };
	}
	const error = messageOf(body);
	// 401 is a token GitHub does not know; 403 and 404 are one it knows that may not create
	// repositories (a rate limit is also a 403, and says so)
	if (res.status === 401) return { ok: false, failure: 'auth', error };
	if ((res.status === 403 && !/rate limit/i.test(error ?? '')) || res.status === 404) return { ok: false, failure: 'scope', error };
	if (res.status === 422 && /already exists/i.test(error ?? '')) return { ok: false, failure: 'exists', error };
	return { ok: false, failure: 'other', error: error ?? `GitHub answered ${res.status}` };
}

/** owner and name of a GitHub repository from its https or SSH address; null for any other host */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
	const m =
		/^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
			url.trim()
		);
	return m ? { owner: m[1], repo: m[2] } : null;
}

export type GithubForkResult = { ok: true; repo: GithubRepo & { owner: string } } | { ok: false; failure: GithubFailure; error?: string };

/**
 * Fork `owner/repo` into the account `token` belongs to. GitHub answers at once and makes the copy
 * in the background, so the first push to it can arrive before it exists (githubFork.ts retries).
 * Asking again for a fork that exists returns that fork.
 */
export async function forkGithubRepo(fetchImpl: FetchLike, token: string, owner: string, repo: string): Promise<GithubForkResult> {
	let res: Awaited<ReturnType<FetchLike>>;
	try {
		res = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/forks`, {
			method: 'POST',
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'Texpile',
				'X-GitHub-Api-Version': '2022-11-28'
			},
			body: '{}'
		});
	} catch (e) {
		return { ok: false, failure: 'network', error: e instanceof Error ? e.message : String(e) };
	}
	const body: unknown = await res.json().catch(() => null);
	if ((res.status === 202 || res.status === 200) && body && typeof body === 'object') {
		const b = body as { full_name?: unknown; html_url?: unknown; clone_url?: unknown; owner?: { login?: unknown } };
		if (
			typeof b.full_name === 'string' &&
			typeof b.html_url === 'string' &&
			typeof b.clone_url === 'string' &&
			typeof b.owner?.login === 'string'
		) {
			return { ok: true, repo: { fullName: b.full_name, htmlUrl: b.html_url, cloneUrl: b.clone_url, owner: b.owner.login } };
		}
		return { ok: false, failure: 'other', error: 'GitHub made the fork but did not say where.' };
	}
	const error = messageOf(body);
	if (res.status === 401) return { ok: false, failure: 'auth', error };
	if ((res.status === 403 && !/rate limit/i.test(error ?? '')) || res.status === 404) return { ok: false, failure: 'scope', error };
	return { ok: false, failure: 'other', error: error ?? `GitHub answered ${res.status}` };
}
