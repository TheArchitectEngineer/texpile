// The open file as it was in the last saved version, for the change bars in the source editor's
// margin (lib/editor/source/cmChangeMarkers.ts). Read when the file opens and again whenever HEAD
// moves - a version saved here or in a terminal, a sync, a switch of branch.
import { gitShowHead } from './git';
import { isGitRepo } from './gitStore';
import { toLf } from './fileSystem';

export class ChangeBaseline {
	/** null: no markers, which is right for a file with no saved version (every line would be new) */
	text = $state<string | null>(null);
	private seq = 0;

	async load(path: string | null): Promise<void> {
		const mine = ++this.seq;
		if (!path || !isGitRepo.current) {
			this.text = null;
			return;
		}
		const res = await gitShowHead(path);
		if (mine !== this.seq) return; // another file, or a newer HEAD, got there first
		this.text = res.ok && res.hasHead ? toLf(res.content ?? '') : null;
	}
}
