// Sign-ins kept between operations (electron/src/gitSignIns.ts), with a vault that seals by
// reversing the text so a test can tell sealed from plain.
import { it, expect } from 'vitest';
import { SignIns, keepable, refusedPassword, settle, type SignInVault } from '../../../../../../electron/src/gitSignIns';

function memoryVault(): SignInVault & { data: Record<string, string> } {
	const v = {
		data: {} as Record<string, string>,
		encrypt: (plain: string) => [...plain].reverse().join(''),
		decrypt: (sealed: string) => [...sealed].reverse().join(''),
		read: () => ({ ...v.data }),
		write: (all: Record<string, string>) => {
			v.data = { ...all };
		}
	};
	return v;
}

const USER = "Username for 'https://github.com': ";
const PASS = "Password for 'https://ada@github.com': ";

it('keeps what was typed once the operation worked, sealed, and answers with it next time', () => {
	const vault = memoryVault();
	const store = new SignIns(vault);
	settle(
		store,
		{ ok: true },
		new Map([
			[USER, 'ada'],
			[PASS, 'ghp_token']
		]),
		new Set()
	);
	expect(vault.data[PASS]).toBe('nekot_phg');
	expect(store.recall(USER)).toBe('ada');
	expect(store.recall(PASS)).toBe('ghp_token');
	expect(store.recall("Password for 'https://ada@gitlab.com': ")).toBeNull();
});

it('keeps nothing from an operation that failed, and drops a kept answer the host refused', () => {
	const vault = memoryVault();
	const store = new SignIns(vault);
	settle(store, { ok: false, failure: 'network' }, new Map([[PASS, 'typo']]), new Set());
	expect(store.recall(PASS)).toBeNull();
	// a Sync that signed in and then met a conflict: the sign-in worked, and is kept
	settle(store, { ok: false, failure: 'conflict' }, new Map([[PASS, 'good-token']]), new Set());
	expect(store.recall(PASS)).toBe('good-token');
	store.forget([PASS]);

	store.keep([[PASS, 'old-token']]);
	// a network failure says nothing about the password: it stays
	settle(store, { ok: false, failure: 'network' }, new Map(), new Set([PASS]));
	expect(store.recall(PASS)).toBe('old-token');
	settle(store, { ok: false, failure: 'auth' }, new Map(), new Set([PASS]));
	expect(store.recall(PASS)).toBeNull();
});

it('keeps a sign-in the host accepted before refusing the upload for another reason', () => {
	const store = new SignIns(memoryVault());
	// someone else's repository: the account is known, it may not write there, and a fork is offered
	settle(store, { ok: false, failure: 'forbidden' }, new Map([[PASS, 'token']]), new Set());
	expect(store.recall(PASS)).toBe('token');
	// publishing over SSH: the token made the repository, then ssh refused the key
	const ssh = { ok: false, failure: 'auth', error: 'git@github.com: Permission denied (publickey).' };
	expect(refusedPassword(ssh)).toBe(false);
	settle(store, ssh, new Map(), new Set([PASS]));
	expect(store.recall(PASS)).toBe('token');
	expect(refusedPassword({ ok: false, failure: 'auth', error: 'Authentication failed' })).toBe(true);
});

it('forgets everything on request, and keeps nothing without a keychain', () => {
	const vault = memoryVault();
	const store = new SignIns(vault);
	store.keep([[PASS, 'x']]);
	store.forgetAll();
	expect(vault.data).toEqual({});

	const none = new SignIns(null);
	expect(none.available).toBe(false);
	none.keep([[PASS, 'x']]);
	expect(none.recall(PASS)).toBeNull();
});

it('keeps usernames and passwords, never passphrases or host keys', () => {
	expect(keepable('username')).toBe(true);
	expect(keepable('password')).toBe(true);
	expect(keepable('passphrase')).toBe(false);
	expect(keepable('host-key')).toBe(false);
	expect(keepable('other')).toBe(false);
});
