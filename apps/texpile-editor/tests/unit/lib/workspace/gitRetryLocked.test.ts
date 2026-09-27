// A Save version that lost a race for .git/index.lock against another git (a terminal, another
// editor) is tried once more rather than reported: the other git is usually done by then.
import { it, expect } from 'vitest';
import { retryLocked } from '../../../../../../electron/src/gitService';

const LOCKED = "fatal: Unable to create '/p/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository";

it('tries once more when the index was locked, and gives up after that', async () => {
	let calls = 0;
	await expect(
		retryLocked(async () => {
			if (++calls === 1) throw new Error(LOCKED);
			return 'done';
		}, 1)
	).resolves.toBe('done');
	expect(calls).toBe(2);

	calls = 0;
	await expect(
		retryLocked(async () => {
			calls++;
			throw new Error(LOCKED);
		}, 1)
	).rejects.toThrow('index.lock');
	expect(calls).toBe(2);
});

it('does not retry any other failure', async () => {
	let calls = 0;
	await expect(
		retryLocked(async () => {
			calls++;
			throw new Error('error: pathspec did not match any files');
		}, 1)
	).rejects.toThrow('pathspec');
	expect(calls).toBe(1);
});
