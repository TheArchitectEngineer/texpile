// Milestones against real repos (gitLiveFixture.ts): marked as annotated tags, listed with History,
// carried by Sync, and removed from the remote as well as here.
import { describe, it, expect, afterEach } from 'vitest';
import { gitMarkMilestone, gitRemoveMilestone, parseTags, tagNameFor } from '../../../../../../electron/src/gitTags';
import { gitLog } from '../../../../../../electron/src/gitHistory';
import { gitSync } from '../../../../../../electron/src/gitRemote';
import { AVAILABLE, run, out, commit, removeTempDirs, makePublished } from './gitLiveFixture';

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

	it('removes a milestone the remote never had, and refuses one that is not there', async () => {
		const { root } = await makePublished();
		run(root, 'tag', '-a', 'local-only', '-m', 'Local only');
		expect((await gitRemoveMilestone(root, 'local-only')).ok).toBe(true);
		expect(await gitRemoveMilestone(root, 'nothing')).toMatchObject({ ok: false, failure: 'missing' });
		expect(await gitMarkMilestone(root, 'not-a-hash', 'x')).toMatchObject({ ok: false, failure: 'invalid' });
		expect(await gitMarkMilestone(root, out(root, 'rev-parse', 'HEAD'), '  ')).toMatchObject({ ok: false, failure: 'invalid' });
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
