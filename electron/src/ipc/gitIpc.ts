// the git:* surface, backing the Source Control panel. Every call runs in the helper process
// (helper/helperWorker.ts); main only relays.
import { helperCall } from '../helper/helperProcess';
import { handleFs, handleFsE } from './ipcResult';
import { timeSpan } from '../startupStats';
import { withAskpass, registerAskpassIpc } from '../gitAskpass';
import { githubPublish } from '../githubPublish';

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
	'git:changesSince': 'gitChangesSince',
	'git:showAt': 'gitShowAt',
	'git:restore': 'gitRestore',
	'git:remotes': 'gitRemotes',
	'git:addRemote': 'gitAddRemote',
	'git:recheck': 'gitRecheck',
	'git:combine': 'gitCombine',
	'git:finishCombine': 'gitFinishCombine',
	'git:cancelCombine': 'gitCancelCombine'
};

// The calls that reach a remote, and so may have to ask someone to sign in: channel -> [gitService
// export, how many arguments the renderer sends]. The askpass environment goes after exactly that
// many, so an extra argument from a confused renderer cannot land where the environment belongs.
const NET_OPS: Record<string, [string, number]> = {
	'git:push': ['gitPush', 1],
	'git:publish': ['gitPublish', 2],
	'git:sync': ['gitSync', 1]
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
	handleFsE('git:githubPublish', (e, root: string, opts: { name: string; isPrivate: boolean; remote: string }) =>
		timeSpan('git:githubPublish', githubPublish(e.sender, root, opts))
	);
	registerAskpassIpc();
}
