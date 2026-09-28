// Switch branch's list: the local branches other than the one checked out, most recently worked on
// first, each with the remote branch it syncs with. VS Code's Git: Checkout to..., for local
// branches only: Texpile does not start branches, and this is the way back to one.
import { GitBranch } from '@lucide/svelte';
import { scmHandlers } from '$lib/workspace/scmHandlers.svelte';
import type { GitBranchesResult } from '$lib/workspace/gitBranches';
import type { PaletteItem } from './paletteCommands';
import { m } from '$lib/paraglide/messages';

/** exported for the tests */
export function branchItemsFrom(res: GitBranchesResult, switchTo: (name: string) => void): PaletteItem[] {
	if (!res.ok) return [];
	return (res.local ?? [])
		.filter((b) => b.name !== res.current)
		.map((b) => ({
			id: `branch:${b.name}`,
			label: b.name,
			group: m.vcs_branch_group(),
			hint: b.upstream ?? undefined,
			icon: GitBranch,
			run: () => switchTo(b.name)
		}));
}

export async function branchItems(): Promise<PaletteItem[]> {
	const h = scmHandlers.current;
	if (!h) return [];
	return branchItemsFrom(await h.listBranches(), (name) => scmHandlers.current?.switchBranch(name));
}
