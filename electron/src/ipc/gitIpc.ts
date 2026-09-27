// the git:* surface, backing the Source Control panel. Every call runs in the helper process
// (helper/helperWorker.ts); main only relays.
import type { WebContents } from 'electron';
import { helperCall, onHelperEvent } from '../helper/helperProcess';
import { handleFs, handleFsE } from './ipcResult';
import { timeSpan } from '../startupStats';
import { withAskpass, registerAskpassIpc } from '../gitAskpass';
import { githubPublish } from '../githubPublish';
import { githubFork } from '../githubFork';

// channel -> gitService export
const OPS: Record<string, string> = {
	'git:status': 'gitStatus',
	'git:show': 'gitShowHead',
	'git:init': 'gitInit',
	'git:stage': 'gitStage',
	'git:unstage': 'gitUnstage',
	'git:discard': 'gitDiscard',
	'git:commit': 'gitCommit',
	'git:identity': 'gitIdentity',
	'git:setIdentity': 'gitSetIdentity',
	'git:log': 'gitLog',
	'git:fileLog': 'gitFileLog',
	'git:changesSince': 'gitChangesSince',
	'git:showAt': 'gitShowAt',
	'git:changesIn': 'gitChangesIn',
	'git:fileAt': 'gitFileAt',
	'git:restore': 'gitRestore',
	'git:remotes': 'gitRemotes',
	'git:addRemote': 'gitAddRemote',
	'git:recheck': 'gitRecheck',
	'git:trustRepo': 'gitTrustRepo',
	'git:combine': 'gitCombine',
	'git:finishCombine': 'gitFinishCombine',
	'git:cancelCombine': 'gitCancelCombine',
	'git:keepSide': 'gitKeepSide',
	'git:branches': 'gitBranches',
	'git:switch': 'gitSwitch',
	'git:createBranch': 'gitCreateBranch',
	'git:trackBranch': 'gitTrackBranch',
	'git:deleteBranch': 'gitDeleteBranch',
	'git:markMilestone': 'gitMarkMilestone'
};

// The calls that reach a remote, and so may have to ask someone to sign in: channel -> [gitService
// export, how many arguments the renderer sends]. The askpass environment goes after exactly that
// many, so an extra argument from a confused renderer cannot land where the environment belongs.
const NET_OPS: Record<string, [string, number]> = {
	'git:push': ['gitPush', 1],
	'git:publish': ['gitPublish', 2],
	'git:sync': ['gitSync', 1],
	'git:fetch': ['gitFetch', 1],
	'git:removeMilestone': ['gitRemoveMilestone', 2],
	'git:deleteRemoteBranch': ['gitDeleteRemoteBranch', 2]
};

export function registerGitIpc(): void {
	for (const [channel, op] of Object.entries(OPS)) {
		handleFs(channel, (...args: unknown[]) => timeSpan(channel, helperCall(`git.${op}`, args)));
	}
	for (const [channel, [op, arity]] of Object.entries(NET_OPS)) {
		handleFsE(channel, (e, ...args: unknown[]) => {
			const given = Array.from({ length: arity }, (_, i) => args[i]);
			return timeSpan(
				channel,
				withAskpass(e.sender, (env) => helperCall(`git.${op}`, [...given, env]) as Promise<{ ok: boolean; failure?: string }>)
			);
		});
	}
	// the automatic check for new versions (VS Code's autofetch): the same fetch, with no one asked
	handleFsE('git:fetchQuiet', (e, root: unknown) =>
		timeSpan(
			'git:fetchQuiet',
			withAskpass(e.sender, (env) => helperCall('git.gitFetch', [root, env]) as Promise<{ ok: boolean; failure?: string }>, { quiet: true })
		)
	);
	// a clone reports its progress as it goes, to the window that asked for it, and only that
	// window can stop it
	let clones = 0;
	const running = new Map<string, WebContents>();
	handleFsE('git:clone', (e, url: string, parent: string, name: string) => {
		const key = `clone-${++clones}`;
		running.set(key, e.sender);
		const off = onHelperEvent((ev) => {
			if (ev.event === 'git-progress' && ev.key === key && !e.sender.isDestroyed()) e.sender.send('git:cloneProgress', ev.data);
		});
		return timeSpan(
			'git:clone',
			withAskpass(
				e.sender,
				(env) => helperCall('git.gitClone', [url, parent, name, env, key]) as Promise<{ ok: boolean; failure?: string }>
			)
		).finally(() => {
			off();
			running.delete(key);
		});
	});
	handleFsE('git:cancelClone', async (e) => {
		for (const [key, sender] of running) if (sender === e.sender) await helperCall('git.cancelClone', [key]);
		return true;
	});
	handleFsE('git:githubFork', (e, root: string, remote: string) => timeSpan('git:githubFork', githubFork(e.sender, root, remote)));
	handleFsE('git:githubPublish', (e, root: string, opts: { name: string; isPrivate: boolean; remote: string; ssh?: boolean }) =>
		timeSpan('git:githubPublish', githubPublish(e.sender, root, opts))
	);
	registerAskpassIpc();
}
