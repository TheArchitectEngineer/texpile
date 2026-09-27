// "Ignore this file" from a change row's menu, carried out by the workspace's ScmActions. A module
// rather than props, as versionChanges.svelte.ts: the row is four components below the workspace.
let handler = $state<((paths: string[]) => void) | null>(null);

/** the workspace takes the requests while it is open; the returned function lets go */
export function handleIgnore(fn: (paths: string[]) => void): () => void {
	handler = fn;
	return () => {
		if (handler === fn) handler = null;
	};
}

export function canIgnore(): boolean {
	return !!handler;
}

export function ignoreFiles(paths: string[]): void {
	handler?.(paths);
}
