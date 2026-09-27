// Milestones against real repos (gitLiveFixture.ts): marked as annotated tags, listed with History,
// carried by Sync, and removed from the remote as well as here.
import { describe, it, expect, afterEach } from 'vitest';
import { gitMarkMilestone, gitRemoveMilestone, parseTags, tagNameFor } from '../../../../../../electron/src/gitTags';
import { gitLog } from '../../../../../../electron/src/gitHistory';
import { gitSync, milestonesToSend } from '../../../../../../electron/src/gitRemote';
import { gitCreateBranch } from '../../../../../../electron/src/gitBranches';
import { simpleGit } from 'simple-git';
import { writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { AVAILABLE, run, out, commit, removeTempDirs, makePublished } from './gitLiveFixture';

/** a remote that takes nothing: the stand-in for someone else's repository */
function refuseEveryPush(remote: string) {
	const hook = join(remote, 'hooks', 'pre-receive');
	writeFileSync(hook, '#!/bin/sh\necho "read only" >&2\nexit 1\n');
	chmodSync(hook, 0o755);
}

afterEach(removeTempDirs);

describe.skipIf(!AVAILABLE)('milestones', () => {
	it('names a version, and History shows the name on it', async () => {
		const { root } = await makePublished();
		const hash = out(root, 'rev-parse', 'HEAD');
		expect(await gitMarkMilestone(root, hash, 'Sent to the committee')).toEqual({ ok: true, name: 'sent-to-the-committee' });
		expect(out(root, 'tag', '-l', '--format=%(objecttype) %(contents:subject)', 'sent-to-the-committee')).toBe('tag Sent to the committee');
		// the same words twice is two milestones, not a refusal
		expect(await gitMarkMilestone(root, hash, 'Sent to the committee')).toEqual({ ok: true, name: 'sent-to-the-committee-2' });

		const log = await gitLog(root);
		expect(log.entries?.[0].milestones?.map((ms) => ms.label)).toEqual(['Sent to the committee', 'Sent to the committee']);
	});

	it('is carried by Sync even when there is no version to send, and removed from the remote too', async () => {
		const { root, remote } = await makePublished();
		const hash = out(root, 'rev-parse', 'HEAD');
		await gitMarkMilestone(root, hash, 'Camera ready');
		expect(await gitSync(root)).toMatchObject({ ok: true, pushed: 0 });
		expect(out(remote, 'tag', '-l')).toBe('camera-ready');

		expect(await gitRemoveMilestone(root, 'camera-ready')).toEqual({ ok: true, name: 'camera-ready' });
		expect(out(root, 'tag', '-l')).toBe('');
		expect(out(remote, 'tag', '-l')).toBe('');
		// and a later Sync does not bring it back
		expect((await gitSync(root)).ok).toBe(true);
		expect(out(root, 'tag', '-l')).toBe('');
	});

	it('goes out with the versions Sync sends', async () => {
		const { root, remote } = await makePublished();
		commit(root, 'main.tex', 'Final.\n', 'Final wording');
		await gitMarkMilestone(root, out(root, 'rev-parse', 'HEAD'), 'Final');
		expect(await gitSync(root)).toMatchObject({ ok: true, pushed: 1 });
		expect(out(remote, 'tag', '-l')).toBe('final');
	});

	it("sends one only once, and a co-author's Sync does not bring back one that was removed", async () => {
		const { root, other, remote } = await makePublished();
		await gitMarkMilestone(root, out(root, 'rev-parse', 'HEAD'), 'Draft one');
		await gitSync(root);
		expect(await milestonesToSend(simpleGit(root))).toEqual([]);
		// the co-author takes it in, then it is removed where it was made
		await gitSync(other);
		expect(out(other, 'tag', '-l')).toBe('draft-one');
		expect((await gitRemoveMilestone(root, 'draft-one')).ok).toBe(true);
		commit(other, 'notes.tex', 'Notes.\n', 'Notes');
		expect(await gitSync(other)).toMatchObject({ ok: true, pushed: 1 });
		expect(out(remote, 'tag', '-l')).toBe('');
	});

	it("never takes a branch's name, and a branch never takes a milestone's", async () => {
		const { root, remote } = await makePublished();
		const branch = out(root, 'symbolic-ref', '--short', 'HEAD');
		const marked = await gitMarkMilestone(root, out(root, 'rev-parse', 'HEAD'), branch);
		expect(marked).toEqual({ ok: true, name: `${branch}-2` });
		commit(root, 'main.tex', 'More.\n', 'More');
		// an upload naming "main" would be ambiguous to git if the milestone had taken that name
		expect(await gitSync(root)).toMatchObject({ ok: true, pushed: 1 });
		expect(out(remote, 'tag', '-l')).toBe(`${branch}-2`);
		expect(await gitCreateBranch(root, `${branch}-2`)).toMatchObject({ ok: false, failure: 'invalid' });
	});

	it('removes a milestone the remote never had, and refuses one that is not there', async () => {
		const { root } = await makePublished();
		run(root, 'tag', '-a', 'local-only', '-m', 'Local only');
		expect((await gitRemoveMilestone(root, 'local-only')).ok).toBe(true);
		expect(await gitRemoveMilestone(root, 'nothing')).toMatchObject({ ok: false, failure: 'missing' });
		expect(await gitMarkMilestone(root, 'not-a-hash', 'x')).toMatchObject({ ok: false, failure: 'invalid' });
		expect(await gitMarkMilestone(root, out(root, 'rev-parse', 'HEAD'), '  ')).toMatchObject({ ok: false, failure: 'invalid' });
	});
});

describe.skipIf(!AVAILABLE || process.platform === 'win32')('milestones where the remote cannot be written to', () => {
	it('still removes one that was never uploaded, and keeps one the remote has', async () => {
		const { root, remote } = await makePublished();
		const hash = out(root, 'rev-parse', 'HEAD');
		await gitMarkMilestone(root, hash, 'Uploaded');
		await gitSync(root);
		refuseEveryPush(remote);
		await gitMarkMilestone(root, hash, 'Only here');
		expect(await gitRemoveMilestone(root, 'only-here')).toEqual({ ok: true, name: 'only-here' });
		// the remote has this one and would bring it back with the next Sync: refused, and kept
		expect((await gitRemoveMilestone(root, 'uploaded')).ok).toBe(false);
		expect(out(root, 'tag', '-l')).toBe('uploaded');
	});

	it('is no reason for Sync to push when it sits on another branch', async () => {
		const { root } = await makePublished();
		run(root, 'switch', '-q', '-c', 'aside');
		commit(root, 'aside.tex', 'Aside.\n', 'Aside');
		await gitMarkMilestone(root, out(root, 'rev-parse', 'HEAD'), 'On aside');
		// an upload of this branch would not carry it, so pushing for it would only meet the remote's
		// refusal: on GitHub, a push with nothing to send still needs write access
		expect(await milestonesToSend(simpleGit(root))).toEqual(['on-aside']);
		run(root, 'switch', '-q', '-');
		expect(await milestonesToSend(simpleGit(root))).toEqual([]);
	});
});

describe('milestone names', () => {
	it('makes a tag name from what was typed, in any script', () => {
		expect(tagNameFor('Sent to the committee')).toBe('sent-to-the-committee');
		expect(tagNameFor('v1.0: camera ready!')).toBe('v1.0-camera-ready');
		expect(tagNameFor('提交给委员会')).toBe('提交给委员会');
		expect(tagNameFor('..~^:?*[\\')).toBe('');
	});

	it('reads annotated and lightweight tags alike', () => {
		const raw = ['sent\x1ftag\x1fabc123\x1ftagobj\x1fSent to the committee', 'v1\x1fcommit\x1f\x1fabc123\x1fsome commit subject'].join(
			'\n'
		);
		expect(parseTags(raw)).toEqual({
			abc123: [
				{ name: 'sent', label: 'Sent to the committee' },
				{ name: 'v1', label: 'v1' }
			]
		});
	});
});
