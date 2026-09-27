import { updateUserData, userData } from '$lib/storage/userData';

// two rows of the picker's grid
const MAX_RECENT_SYMBOLS = 20;

/** `name` moved to the front of `recent`, once, the list kept to its length */
export function withRecentSymbol(recent: readonly string[], name: string): string[] {
	return [name, ...recent.filter((n) => n !== name)].slice(0, MAX_RECENT_SYMBOLS);
}

/** the names picked lately, most recent first */
export function recentTypstSymbolNames(): readonly string[] {
	return userData.current.recentTypstSymbols.slice(0, MAX_RECENT_SYMBOLS);
}

export function rememberTypstSymbol(name: string): void {
	updateUserData({ recentTypstSymbols: withRecentSymbol(userData.current.recentTypstSymbols, name) });
}
