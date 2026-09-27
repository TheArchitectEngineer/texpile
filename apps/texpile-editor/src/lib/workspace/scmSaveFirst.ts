// Unsaved work in the way of a branch switch or a Sync, saved as a version first and then the
// operation tried again. A writer's word for keeping work safe is a version; VS Code offers to
// stash it instead, which puts it somewhere nobody who does not know git will look for it.
import { gitChanges, refreshGitStatus } from './gitStore';
import { workspaceRoot } from './workspaceStore';
import { isBuildArtifact } from './buildArtifacts';
import { relativeInside, samePath } from './fileSystem';
import type { GitStatusEntry } from './git';
import { promptAsk } from '$lib/modals/confirm.svelte';
import { m } from '$lib/paraglide/messages';

/** the operation that asked: how to save a version, and its busy flag, handed back while the save runs */
type Host = { commit(message: string, paths: string[]): Promise<boolean>; setBusy(on: boolean): void };

/** true once everything changed is saved as a version; false when the author said no, or saving failed */
export async function saveChangesFirst(
	host: Host,
	ask: { title: string; message: string; detail?: string; confirm: string; version: string; blocking?: string[] }
): Promise<boolean> {
	const choice = await promptAsk({
		title: ask.title,
		message: ask.message,
		detail: ask.detail,
		buttons: [
			{ id: 'save', label: ask.confirm, primary: true },
			{ id: 'cancel', label: m.vcs_cancel() }
		],
		cancelId: 'cancel'
	});
	if (choice !== 'save') return false;
	// commit keeps its own busy state; the operation that asked takes it back after
	host.setBusy(false);
	try {
		// Read again first: the busy flag held status refreshes back, so the list is from before the
		// caller wrote the waiting edit to disk, and that edit is often the very file in the way.
		const root = workspaceRoot.current;
		if (root) await refreshGitStatus(root);
		// not new build output, and not a whole folder of new files: both start unticked in the panel
		// too. Unless git named one as in the way (a main.bbl a co-author saved, and a build made here
		// as well): leaving that out would save nothing that helps, and the button would do nothing
		function inTheWay(c: GitStatusEntry): boolean {
			return (ask.blocking ?? []).some((f) => samePath(f, c.path) || (!!c.files && !!relativeInside(c.path, f)));
		}
		const paths = gitChanges.current
			.filter((c) => inTheWay(c) || (!c.files && !(c.x === '?' && isBuildArtifact(c.path))))
			.map((c) => c.path);
		return paths.length > 0 && (await host.commit(ask.version, paths));
	} finally {
		host.setBusy(true);
	}
}
