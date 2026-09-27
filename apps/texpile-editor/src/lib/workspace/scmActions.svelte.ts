// source control ops: call the git client, refresh status, toast on failure. the panel is
// presentational; WorkspaceView wires the deps.
import { workspaceRoot } from './workspaceStore';
import { refreshGitStatus, refreshGitHistory, isGitRepo, gitChanges, gitBranch } from './gitStore';
import {
	gitInit,
	gitStage,
	gitUnstage,
	gitDiscard,
	gitCommit,
	gitRestore,
	gitChangesSince,
	gitIdentity,
	gitSetIdentity,
	gitRemotes,
	gitAddRemote,
	gitPublish,
	gitSync,
	githubPublish,
	type GitStatusEntry,
	type GitFileChange,
	type GitRemote,
	type GitPushResult
} from './git';
import { askIdentity, askPublish, type PublishChoice } from './gitDialogs.svelte';
import { uploadReason } from './uploadReason';
import { basename, samePath, joinPath } from './fileSystem';
import { confirmAsk } from '$lib/modals/confirm.svelte';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';

export type ScmDeps = {
	getLoadedPath(): string | null;
	/** drop the open file's queued autosave before git rewrites it on disk. */
	discardPendingSave(): void;
	/** an edit is typed but not yet on disk. With autosave off that is everything since the last
	 *  manual save, and git cannot see any of it. */
	hasPendingSave(): boolean;
	/** write that edit out and wait for it to land, so git can see it */
	flushPendingSave(): Promise<void>;
	deleteEntry(path: string): Promise<unknown>;
	refreshTree(): Promise<void>;
	loadFile(path: string): Promise<void>;
	/** re-diff the open comparison (after a commit moved HEAD). */
	captureDiffSnapshot(): void;
	isDiffMode(): boolean;
	/** open (or focus) a tab comparing `path` against one version. */
	openCompareTab(path: string, compare: { hash: string; subject: string }): void;
	/** the .gitignore patterns for this project's compile format */
	ignoreLines(): string[];
	writeText(path: string, content: string): Promise<void>;
	/** null when the file does not exist yet */
	readTextIfPresent(path: string): Promise<string | null>;
};

export class ScmActions {
	busy = $state(false);

	constructor(private deps: ScmDeps) {}

	init = async () => {
		const root = workspaceRoot.current;
		if (!root) return;
		this.busy = true;
		const res = await gitInit(root);
		this.busy = false;
		if (!res.ok) {
			toaster.error({ title: m.wsview_toast_git_init_failed_title(), description: res.error });
			return;
		}
		await refreshGitStatus(root);
		toaster.success({ title: m.wsview_toast_git_init_success_title() });
	};

	stage = async (paths: string[]) => {
		const root = workspaceRoot.current;
		if (!root) return;
		this.busy = true;
		const res = await gitStage(root, paths);
		this.busy = false;
		if (!res.ok) toaster.error({ title: m.wsview_toast_stage_failed_title(), description: res.error });
		await refreshGitStatus(root);
	};

	unstage = async (paths: string[]) => {
		const root = workspaceRoot.current;
		if (!root) return;
		this.busy = true;
		const res = await gitUnstage(root, paths);
		this.busy = false;
		if (!res.ok) toaster.error({ title: m.wsview_toast_unstage_failed_title(), description: res.error });
		await refreshGitStatus(root);
	};

	discard = async (changes: GitStatusEntry[]) => {
		const root = workspaceRoot.current;
		if (!root || !changes.length) return;
		const confirmMsg =
			changes.length === 1
				? m.wsview_confirm_discard_one({ name: basename(changes[0].path) })
				: m.wsview_confirm_discard_other({ count: changes.length });
		if (!(await confirmAsk(confirmMsg, { confirmLabel: m.vcs_discard_changes(), danger: true }))) return;
		// if the open file is being discarded, drop its queued autosave first: otherwise a debounced
		// write scheduled just before the confirm lands after git reverts and re-creates the changes
		const loadedPath = this.deps.getLoadedPath();
		if (loadedPath && changes.some((c) => samePath(c.path, loadedPath))) this.deps.discardPendingSave();
		this.busy = true;
		// untracked files are deleted; tracked files are reverted to their staged/committed state
		const untracked = changes.filter((c) => c.x === '?').map((c) => c.path);
		const tracked = changes.filter((c) => c.x !== '?').map((c) => c.path);
		let err: string | undefined;
		for (const p of untracked) {
			try {
				await this.deps.deleteEntry(p);
			} catch (e) {
				err = e instanceof Error ? e.message : String(e);
			}
		}
		if (tracked.length) {
			const res = await gitDiscard(root, tracked);
			if (!res.ok) err = res.error;
		}
		this.busy = false;
		if (err) toaster.error({ title: m.wsview_toast_discard_failed_title(), description: err });
		// samePath, as two lines above: git and the file tree hand back separators and case that do
		// not always match, and a miss here leaves the editor showing content that is no longer on disk
		const openAffected = !!loadedPath && changes.some((c) => samePath(c.path, loadedPath));
		await this.deps.refreshTree();
		await refreshGitStatus(root);
		if (openAffected && loadedPath) await this.deps.loadFile(loadedPath); // its on-disk content changed
		// an open comparison was computed against the changes just thrown away, and went on showing
		// them as additions and deletions that no longer exist anywhere
		if (this.deps.isDiffMode()) this.deps.captureDiffSnapshot();
	};

	/** the index is reset and rebuilt from the tick boxes every time, so what the button promised
	 *  is what lands and a stale staged file cannot ride along */
	commit = async (message: string, paths: string[]): Promise<boolean> => {
		const root = workspaceRoot.current;
		if (!root || !paths.length) return false;
		// busy from the start: Save version must not be pressable again behind the identity dialog
		this.busy = true;
		if (!(await this.ensureIdentity(root))) {
			this.busy = false;
			return false;
		}
		// an edit still waiting for autosave is what the author means by this version; written out
		// first, as Restore and Sync already do, or the version quietly leaves it behind
		if (this.deps.hasPendingSave()) await this.deps.flushPendingSave();
		const clear = await gitUnstage(root, []);
		if (!clear.ok) {
			this.busy = false;
			toaster.error({ title: m.wsview_toast_unstage_failed_title(), description: clear.error });
			return false;
		}
		const staged = await gitStage(root, paths);
		if (!staged.ok) {
			this.busy = false;
			toaster.error({ title: m.wsview_toast_stage_failed_title(), description: staged.error });
			return false;
		}
		const res = await gitCommit(root, message);
		this.busy = false;
		if (!res.ok) {
			toaster.error({ title: m.wsview_toast_commit_failed_title(), description: res.error });
			return false;
		}
		await refreshGitStatus(root);
		await refreshGitHistory(root);
		if (this.deps.isDiffMode()) this.deps.captureDiffSnapshot(); // the open diff now compares against the new HEAD
		toaster.success({ title: m.wsview_toast_commit_created_title() });
		return true;
	};

	/** git will not commit without a name and an email, and says so in words that send someone to
	 *  a terminal to type two config commands. Those two commands, asked here instead - once per
	 *  machine, since they are written globally. */
	private async ensureIdentity(root: string): Promise<boolean> {
		const who = await gitIdentity(root);
		if (who.name && who.email) return true;
		const answer = await askIdentity({ name: who.name ?? '', email: who.email ?? '' });
		if (!answer) return false;
		const res = await gitSetIdentity(root, answer.name, answer.email);
		if (!res.ok) toaster.error({ title: m.vcs_identity_failed(), description: res.error });
		return res.ok;
	}

	/** Clears the way for a restore, and asks about it first.
	 *
	 *  Returns false when the answer was no, or when saving failed. Nothing is written before the
	 *  answer: with autosave off, a Restore that was cancelled must not have saved the file as a
	 *  side effect of being considered. */
	private async saveBeforeRestore(root: string, entry: { hash: string; subject: string }): Promise<boolean> {
		function inTheWay(): string[] {
			return gitChanges.current.filter((c) => c.x !== '?').map((c) => c.path);
		}
		const dirty = this.deps.hasPendingSave() || inTheWay().length > 0;

		const ok = await confirmAsk(
			dirty ? m.vcs_confirm_restore_unsaved({ name: entry.subject }) : m.vcs_confirm_restore({ name: entry.subject }),
			{ confirmLabel: dirty ? m.vcs_save_and_restore() : m.vcs_restore() }
		);
		if (!ok || !dirty) return ok;

		await this.deps.flushPendingSave();
		await refreshGitStatus(root); // the edit is on disk now, so git can finally count it
		const paths = inTheWay();
		if (!paths.length) return true; // what was queued turned out to match what was already saved
		return this.commit(m.vcs_restore_presave({ name: entry.subject }), paths);
	}

	/** additive: recorded as a new commit, so restoring the entry above undoes it.
	 *  Takes the ENTRY, like compare does - the panel has only ever handed one over, and taking a
	 *  hash and a subject instead meant the entry arrived as `hash` and the subject as undefined. */
	restore = async (entry: { hash: string; subject: string }): Promise<boolean> => {
		const root = workspaceRoot.current;
		if (!root) return false;

		// Work that would be in the way, counted BEFORE asking - the restore refuses on a dirty tree,
		// and being refused after confirming reads as a bug. Only TRACKED changes count: gitRestore
		// checks --untracked-files=no, so an untracked file neither blocks it nor belongs in the
		// version below, having never been chosen for the repo. The typed-but-unwritten edit counts
		// too, and git cannot see it - that is exactly the work the old discard threw away in silence.
		if (!(await this.saveBeforeRestore(root, entry))) return false;
		// restoring writes a version, and on a clean tree it does so without passing through commit()
		if (!(await this.ensureIdentity(root))) return false;

		this.busy = true;
		const res = await gitRestore(root, entry.hash, m.vcs_restore_message({ name: entry.subject }));
		this.busy = false;
		if (!res.ok) {
			toaster.error({ title: m.vcs_toast_restore_failed(), description: res.error });
			return false;
		}
		const loadedPath = this.deps.getLoadedPath();
		await this.deps.refreshTree();
		await refreshGitStatus(root);
		await refreshGitHistory(root);
		if (loadedPath) await this.deps.loadFile(loadedPath); // its bytes on disk just changed
		toaster.success({ title: m.vcs_toast_restored() });
		return true;
	};

	/** Appends, never replaces, and skips lines already present, so an existing .gitignore is not
	 *  rewritten out from under the project. The output PDF is deliberately not among them. */
	ignoreArtifacts = async (): Promise<void> => {
		const root = workspaceRoot.current;
		if (!root) return;
		const path = joinPath(root, '.gitignore');
		this.busy = true;
		try {
			const existing = await this.deps.readTextIfPresent(path);
			const have = new Set(
				(existing ?? '')
					.split('\n')
					.map((l) => l.trim())
					.filter(Boolean)
			);
			const wanted = this.deps.ignoreLines().filter((l) => l.startsWith('#') || !have.has(l));
			// nothing but the header left: every pattern is already there
			if (wanted.every((l) => l.startsWith('#'))) {
				this.busy = false;
				toaster.success({ title: m.vcs_toast_ignored() });
				return;
			}
			const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
			await this.deps.writeText(path, `${existing ?? ''}${prefix}${existing ? '\n' : ''}${wanted.join('\n')}\n`);
		} catch (e) {
			this.busy = false;
			toaster.error({ title: m.vcs_toast_ignore_failed(), description: e instanceof Error ? e.message : String(e) });
			return;
		}
		this.busy = false;
		await this.deps.refreshTree();
		await refreshGitStatus(root);
		toaster.success({ title: m.vcs_toast_ignored() });
	};

	/** against the last saved version, in its own tab */
	openDiff = (path: string) => {
		if (!isGitRepo.current) return;
		this.deps.openCompareTab(path, { hash: 'HEAD', subject: m.vcs_last_version() });
	};

	/** the panel hands over the file rather than asking the editor what happens to be open */
	compare = (entry: { hash: string; subject: string }, path: string) => {
		if (!isGitRepo.current || !path) return;
		this.deps.openCompareTab(path, { hash: entry.hash, subject: entry.subject });
	};

	/** VS Code's Publish Branch: give a branch with no upstream one. With exactly one remote there is
	 *  nothing to choose, so it goes straight there; otherwise the dialog offers each remote, a new
	 *  GitHub repository, or an address. */
	publish = async (): Promise<void> => {
		const root = workspaceRoot.current;
		const branch = gitBranch.current;
		if (!root || !branch || this.busy) return;
		const listed = await gitRemotes(root);
		const remotes = listed.ok ? (listed.remotes ?? []) : [];
		if (remotes.length === 1) {
			this.busy = true;
			const res = await gitPublish(root, remotes[0].name);
			this.busy = false;
			const problem = await this.published(root, res);
			if (problem) toaster.error({ title: m.vcs_toast_publish_failed(), description: problem });
			return;
		}
		await askPublish({
			branch,
			remotes,
			defaultName: basename(root)
				.trim()
				.replace(/[^A-Za-z0-9_.-]+/g, '-'),
			submit: (choice) => this.publishTo(root, choice)
		});
	};

	/** Runs one choice from the Publish dialog. Resolves to the problem to show in the dialog - ''
	 *  for none, when the author closed the sign-in prompt - or null when the dialog is done. */
	private publishTo = async (root: string, choice: PublishChoice): Promise<string | null> => {
		this.busy = true;
		try {
			if (choice.kind === 'remote') return await this.published(root, await gitPublish(root, choice.remote));

			// read again rather than trusting the dialog's list: an attempt that failed after adding
			// its remote has already changed it, and adding the same address twice would fail
			const listed = await gitRemotes(root);
			const current = listed.ok ? (listed.remotes ?? []) : [];

			if (choice.kind === 'url') {
				const known = current.find((r) => r.url === choice.url);
				const name = known?.name ?? freeRemoteName(current, ['origin']);
				if (!known) {
					const added = await gitAddRemote(root, name, choice.url);
					if (!added.ok) return added.error ? `${m.vcs_publish_bad_url()}\n${added.error}` : m.vcs_publish_bad_url();
				}
				return await this.published(root, await gitPublish(root, name));
			}

			const res = await githubPublish(root, {
				name: choice.name,
				isPrivate: choice.isPrivate,
				remote: freeRemoteName(current, ['origin', 'github'])
			});
			if (res.ok) {
				await refreshGitStatus(root);
				const url = res.url;
				toaster.success({
					title: m.vcs_toast_published_github({ name: res.fullName ?? choice.name }),
					action: url ? { label: m.vcs_open_on_github(), onClick: () => void window.open(url, '_blank') } : undefined
				});
				return null;
			}
			if (res.failure === 'cancelled') return '';
			if (res.url) {
				// The repository exists and is already this project's remote; only the upload after it
				// failed. Trying again from here would try to create it again, so the dialog closes and
				// Publish - which now finds exactly that one remote - retries just the upload.
				await refreshGitStatus(root);
				toaster.error({
					title: m.vcs_toast_publish_failed(),
					description: m.vcs_publish_created_not_uploaded({ name: res.fullName ?? choice.name, reason: uploadReason(res) })
				});
				return null;
			}
			if (res.failure === 'exists') return m.vcs_publish_exists({ name: choice.name });
			if (res.failure === 'scope') return m.vcs_publish_scope();
			if (res.failure === 'auth') return m.vcs_publish_github_auth();
			return uploadReason({ ...res, failure: res.failure === 'network' ? 'network' : 'other', remote: 'GitHub' });
		} finally {
			this.busy = false;
		}
	};

	/** after a push -u: '' when the author cancelled signing in, the reason it failed, or null */
	private async published(root: string, res: GitPushResult): Promise<string | null> {
		if (!res.ok && res.failure === 'rejected') return m.vcs_publish_rejected({ remote: res.remote ?? '' });
		if (!res.ok) return res.failure === 'cancelled' ? '' : uploadReason(res);
		await refreshGitStatus(root); // the branch tracks something now, and the panel shows Sync
		toaster.success({ title: m.vcs_toast_published({ remote: res.remote ?? '' }) });
		return null;
	}

	/**
	 * VS Code's Sync: fetch, take in the remote's versions, send this branch's. It never leaves the
	 * project half-combined - a conflict is undone and named, and unsaved work that would be
	 * overwritten stops it before anything is tried.
	 *
	 * A typed edit still waiting to be written goes to disk first. Otherwise git cannot see it, so
	 * cannot refuse to overwrite it, and the write landing after the sync would quietly undo what
	 * came in.
	 */
	sync = async (): Promise<void> => {
		const root = workspaceRoot.current;
		if (!root || this.busy) return;
		this.busy = true;
		try {
			// joining two histories writes a merge version, which git refuses without a name and email
			if (!(await this.ensureIdentity(root))) return;
			if (this.deps.hasPendingSave()) await this.deps.flushPendingSave();
			const res = await gitSync(root);
			if (res.ok && res.pulled) {
				// files changed on disk under the editor: the same reload a restore does
				const loadedPath = this.deps.getLoadedPath();
				await this.deps.refreshTree();
				if (loadedPath) await this.deps.loadFile(loadedPath);
				if (this.deps.isDiffMode()) this.deps.captureDiffSnapshot();
			}
			// even a failed sync fetched, so the counts beside the button are news either way
			await refreshGitStatus(root);
			if (res.ok && (res.pulled || res.pushed)) await refreshGitHistory(root);
			const remote = res.remote ?? '';
			if (res.ok) {
				// name what moved, and only the direction something moved in
				const pulled = res.pulled ?? 0;
				const pushed = res.pushed ?? 0;
				const moved = [
					...(pulled ? [pulled === 1 ? m.vcs_sync_received_one() : m.vcs_sync_received_count({ count: pulled })] : []),
					...(pushed ? [pushed === 1 ? m.vcs_sync_sent_one() : m.vcs_sync_sent_count({ count: pushed })] : [])
				];
				toaster.success(
					moved.length
						? { title: m.vcs_toast_synced({ remote }), description: moved.join(' · ') }
						: { title: m.vcs_toast_sync_uptodate({ remote }) }
				);
			} else if (res.failure !== 'cancelled') {
				toaster.error({ title: m.vcs_toast_sync_failed(), description: uploadReason(res) });
			}
		} finally {
			this.busy = false;
		}
	};

	/** read on expand, not with the log: the answer changes as the author types */
	changesSince = async (hash: string): Promise<GitFileChange[]> => {
		const root = workspaceRoot.current;
		if (!root || !isGitRepo.current) return [];
		const res = await gitChangesSince(root, hash);
		return res.ok ? (res.entries ?? []) : [];
	};
}

/** the first of `preferred` no remote is called yet, else origin2, origin3, ... */
function freeRemoteName(remotes: GitRemote[], preferred: string[]): string {
	const taken = new Set(remotes.map((r) => r.name));
	const free = preferred.find((n) => !taken.has(n));
	if (free) return free;
	let i = 2;
	while (taken.has(`origin${i}`)) i++;
	return `origin${i}`;
}
