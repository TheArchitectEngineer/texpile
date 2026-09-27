// Whether Find Entry to Restore is open (FindLocalHistoryModal.svelte): from the palette and the
// Timeline's menu, drawn by the workspace.
let open = $state(false);

export const localHistoryFinder = {
	get open() {
		return open;
	}
};

export function openLocalHistoryFinder(): void {
	open = true;
}

export function closeLocalHistoryFinder(): void {
	open = false;
}
