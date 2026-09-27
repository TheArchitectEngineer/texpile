// wrapper around the harper.js WorkerLinter singleton
import type { Lint, LintConfig, LintOptions, WorkerLinter } from 'harper.js';
import { editorConfigStore } from '$lib/stores/editorStore';
import { mark } from '$lib/debug/startupDoctor';
import { settings } from '$lib/settings';
import { observe } from '$lib/runes/observe.svelte';
import { browser } from '$lib/runtime';
import { ruleConfig, systemVariant, type EnglishVariant } from './grammarRules';

let linterPromise: Promise<WorkerLinter> | null = null;

let lastLoadedDictionary: string[] = [];

async function createLinter(): Promise<WorkerLinter> {
	// harper's js glue is heavy, so it loads with the first lint instead of at boot (the wasm
	// was already lazy)
	mark('harper-start');
	// harper.js 2 moved the wasm binaries to subpath exports; this is the full one, not slim
	const [{ WorkerLinter, Dialect }, { binary }] = await Promise.all([import('harper.js'), import('harper.js/binary')]);
	const linter = new WorkerLinter({
		binary,
		dialect: Dialect.American
	});

	// setup up front so the first lint isn't slow
	await linter.setup();
	mark('harper-ready');

	await linter.importWords(['Texpile', 'LaTeX', 'WYSIWYM', 'CTRL', 'CMD']);
	await configure(linter);

	return linter;
}

/** the English and the rule choices the checker should have now */
function wanted(): { variant: EnglishVariant; rules: Record<string, boolean> } {
	const s = settings.current;
	return {
		variant: s.englishVariant || systemVariant(browser ? navigator.languages : []),
		rules: s.grammarRules ?? {}
	};
}

// what the linter was last given, so a settings write about something else changes nothing
let configuredFor = '';

let configuring: Promise<unknown> = Promise.resolve();

/** gives the linter the English and the rules the settings ask for; false when it had them */
function configure(linter: WorkerLinter): Promise<boolean> {
	// one at a time, so two quick changes cannot land their halves out of order
	const run = configuring.then(() => configureNow(linter));
	configuring = run.catch(() => {});
	return run;
}

async function configureNow(linter: WorkerLinter): Promise<boolean> {
	const want = wanted();
	const key = JSON.stringify(want);
	if (key === configuredFor) return false;
	const { Dialect } = await import('harper.js');
	const dialects: Record<EnglishVariant, number> = {
		american: Dialect.American,
		british: Dialect.British,
		australian: Dialect.Australian,
		canadian: Dialect.Canadian,
		indian: Dialect.Indian
	};
	await linter.setDialect(dialects[want.variant]);
	const rules = Object.keys(await linter.getDefaultLintConfig());
	await linter.setLintConfig(ruleConfig(rules, want.rules));
	configuredFor = key;
	return true;
}

const rulesListeners = new Set<() => void>();

/** `fn` runs whenever the English or the rules change, so an editor can check its text again */
export function onLintRulesChanged(fn: () => void): () => void {
	rulesListeners.add(fn);
	return () => rulesListeners.delete(fn);
}

// a linter not made yet reads the settings when it is; one already running is told
observe(wanted, () => {
	if (!linterPromise) return;
	void linterPromise
		.then(configure)
		.then((changed) => changed && rulesListeners.forEach((fn) => fn()))
		.catch((error) => console.error('[Harper] Failed to apply the grammar settings:', error));
});

export async function getHarperLinter(): Promise<WorkerLinter> {
	linterPromise ??= createLinter();
	return linterPromise;
}

/** lints text, returning matches in prosemirror-proofread format. */
export async function lintText(
	text: string,
	options?: { language?: LintOptions['language']; isStale?: () => boolean }
): Promise<{
	matches: Array<{
		offset: number;
		length: number;
		message: string;
		shortMessage?: string;
		type: { typeName: string };
		replacements?: string[];
		/** the Harper rule that found it */
		rule: string;
	}>;
	/** worker/wasm failure: callers must NOT cache the empty result as "no problems". */
	failed?: true;
}> {
	try {
		const linter = await getHarperLinter();
		// by rule, so a suggestion can offer to turn off the rule that made it
		const byRule: Record<string, Lint[]> = await linter.organizedLints(
			text,
			options?.language ? { language: options.language } : undefined
		);
		// mapping below hydrates wasm objects on the main thread; skip it when the caller already
		// knows the result is superseded
		if (options?.isStale?.()) return { matches: [] };

		const lints = Object.entries(byRule).flatMap(([rule, found]) => found.map((lint) => ({ rule, lint })));
		const matches = lints.map(({ rule, lint }) => {
			const span = lint.span();
			const suggestions: string[] = [];

			// suggestions() re-materializes the wasm array on every call, so read it once
			for (const sug of lint.suggestions()) {
				const replacement = sug.get_replacement_text();
				if (replacement) {
					suggestions.push(replacement);
				}
			}

			// prosemirror-proofread prefixes typeName with 'proofread-' for the css styling
			const lintKind = lint.lint_kind();

			ruleOfList.set(suggestions, rule);
			const match = {
				offset: span.start,
				length: span.end - span.start,
				message: lint.message(),
				shortMessage: lint.message().split('.')[0],
				type: {
					typeName: lintKind || 'miscellaneous'
				},
				replacements: suggestions,
				rule
			};
			return match;
		});
		matches.sort((a, b) => a.offset - b.offset || a.length - b.length);

		return { matches };
	} catch (error) {
		console.error('[Harper] Linting error:', error);
		return { matches: [], failed: true };
	}
}

// prosemirror-proofread copies the fields of a match it knows into its own problem and drops the
// rest, but hands the replacements list over as it is: the rule is found again from that list
const ruleOfList = new WeakMap<object, string>();

/** the rule that found a match, from its replacements list; null for a list no lint made */
export function ruleOfReplacements(list: unknown): string | null {
	return (typeof list === 'object' && list !== null && ruleOfList.get(list)) || null;
}

export async function addWordsToDictionary(words: string[]): Promise<void> {
	const linter = await getHarperLinter();
	await linter.importWords(words);
}

export async function clearDictionary(): Promise<void> {
	const linter = await getHarperLinter();
	await linter.clearWords();
}

let descriptions: Promise<Record<string, string>> | null = null;

/** what each rule looks for, in Harper's words (English, as its findings are) */
export function lintDescriptions(): Promise<Record<string, string>> {
	descriptions ??= getHarperLinter().then((linter) => linter.getLintDescriptions());
	return descriptions;
}

export async function getLintConfig(): Promise<LintConfig> {
	const linter = await getHarperLinter();
	return await linter.getLintConfig();
}

export async function setLintConfig(config: LintConfig): Promise<void> {
	const linter = await getHarperLinter();
	await linter.setLintConfig(config);
}

export async function exportDictionary(): Promise<string[]> {
	const linter = await getHarperLinter();
	return await linter.exportWords();
}

/** loads custom words from editorConfigStore into harper's dictionary. */
export async function syncDocumentDictionary(): Promise<void> {
	const linter = await getHarperLinter();
	const currentConfig = editorConfigStore.current;
	const documentDictionary = currentConfig?.dictionary || [];

	const dictionaryChanged =
		documentDictionary.length !== lastLoadedDictionary.length || documentDictionary.some((word, i) => word !== lastLoadedDictionary[i]);

	if (dictionaryChanged) {
		console.log('[Harper] Syncing document dictionary:', documentDictionary);

		await linter.clearWords();

		await linter.importWords(['Texpile', 'LaTeX', 'ProseMirror', 'WebAssembly', 'TypeScript', 'JavaScript']);

		if (documentDictionary.length > 0) {
			await linter.importWords(documentDictionary);
		}

		lastLoadedDictionary = [...documentDictionary];
	}
}

export async function addWordToDocumentDictionary(word: string): Promise<void> {
	await addWordsToDocumentDictionary([word]);
}

/** adds each of `words` not in the dictionary yet; the words it added */
export async function addWordsToDocumentDictionary(words: readonly string[]): Promise<string[]> {
	const currentConfig = editorConfigStore.current;
	if (!currentConfig) return [];
	const currentDictionary = currentConfig.dictionary || [];
	const fresh = [...new Set(words.map((w) => w.trim().toLowerCase()).filter((w) => w && !currentDictionary.includes(w)))];
	if (!fresh.length) return [];

	editorConfigStore.current = { ...currentConfig, dictionary: [...currentDictionary, ...fresh] };
	const linter = await getHarperLinter();
	await linter.importWords(fresh);
	lastLoadedDictionary = [...currentDictionary, ...fresh];
	return fresh;
}

export async function removeWordFromDocumentDictionary(word: string): Promise<void> {
	const currentConfig = editorConfigStore.current;
	const currentDictionary = currentConfig?.dictionary || [];

	const normalizedWord = word.trim().toLowerCase();

	if (!currentDictionary.includes(normalizedWord)) {
		console.log('[Harper] Word not in dictionary:', normalizedWord);
		return;
	}

	console.log('[Harper] Removing word from dictionary:', normalizedWord);

	if (!currentConfig) return;
	const updatedConfig = {
		...currentConfig,
		dictionary: currentDictionary.filter((w) => w !== normalizedWord)
	};
	editorConfigStore.current = updatedConfig;

	await syncDocumentDictionary();
}
