// The Source Control dialogs that need more than a message box: who is committing, where a branch
// is published, and git's own sign-in questions. ScmActions awaits the first two the way it awaits
// confirmAsk; the third arrives from main whenever git asks (electron/src/gitAskpass.ts).
// GitDialogsHost draws all three.
import { nativeBridge } from './fileSystem';
import type { GitAskpassRequest, GitRemote } from './git';

// for the dialogs, which live where the web build's lint keeps git itself out
export type { GitAskpassRequest as GitQuestion } from './git';

export type Identity = { name: string; email: string };

/** where a branch goes: a GitHub repository made for it, a remote the repository already has, or
 *  one added by its address */
export type PublishChoice =
	{ kind: 'github'; name: string; isPrivate: boolean } | { kind: 'remote'; remote: string } | { kind: 'url'; url: string };

export type PublishAsk = {
	branch: string;
	remotes: GitRemote[];
	/** what a new GitHub repository is called unless the author says otherwise */
	defaultName: string;
	/** Runs the choice while the dialog stays up, so a taken name or a bad address is fixed in place
	 *  rather than started over. Resolves to the error to show, or null when it is done. */
	submit: (choice: PublishChoice) => Promise<string | null>;
};

type Pending<T, A> = T & { resolve: (answer: A) => void };

let identity = $state<Pending<Identity, Identity | null> | null>(null);
let publish = $state<Pending<PublishAsk, boolean> | null>(null);
let questions = $state<GitAskpassRequest[]>([]);

export const gitDialogs = {
	get identity() {
		return identity;
	},
	get publish() {
		return publish;
	},
	/** the question on screen; any others wait behind it */
	get question() {
		return questions[0] ?? null;
	}
};

/** the name and email to commit with, starting from what git has (either may be blank); null when
 *  the author backs out */
export function askIdentity(current: Identity): Promise<Identity | null> {
	identity?.resolve(null); // a newer ask supersedes this one
	return new Promise((resolve) => {
		identity = { ...current, resolve };
	});
}

export function answerIdentity(answer: Identity | null): void {
	const c = identity;
	identity = null;
	c?.resolve(answer);
}

/** true once the branch is published, false when the author backs out */
export function askPublish(ask: PublishAsk): Promise<boolean> {
	publish?.resolve(false);
	return new Promise((resolve) => {
		publish = { ...ask, resolve };
	});
}

export function closePublish(done: boolean): void {
	const c = publish;
	publish = null;
	c?.resolve(done);
}

/** Put git's questions on screen as they arrive. Returns the unsubscribe; outside the desktop app
 *  there is no git to ask anything. */
export function listenForGitQuestions(): () => void {
	const n = nativeBridge();
	if (!n?.onGitAskpass) return () => {};
	const offAsk = n.onGitAskpass((req) => {
		questions = [...questions, req];
	});
	// the operation ended (or its window went away) with the question still up
	const offClosed = n.onGitAskpassClosed?.((ids) => {
		questions = questions.filter((q) => !ids.includes(q.id));
	});
	return () => {
		offAsk();
		offClosed?.();
	};
}

/** null is Cancel, which fails the git that asked - and every later question in the same operation */
export function answerQuestion(id: number, answer: string | null): void {
	questions = questions.filter((q) => q.id !== id);
	void nativeBridge()?.gitAskpassReply?.(id, answer);
}
