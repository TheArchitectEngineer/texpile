// Which English the checker follows, and which of its rules run.
//
// Harper turns on nearly all of its ~800 rules. A few of them misfire on a paper nearly every
// time: they were run over eight arXiv papers (57,720 words of prose once the markup was masked),
// and what they flagged was LaTeX doing its job or the ordinary language of a paper, not mistakes.
// Those start off. Anyone can turn any rule off from its suggestion, and back on in Preferences;
// only those choices are stored, so a rule nobody touched follows the defaults here.

export const ENGLISH_VARIANTS = ['american', 'british', 'australian', 'canadian', 'indian'] as const;
export type EnglishVariant = (typeof ENGLISH_VARIANTS)[number];

/** the rules that start off, and what they flagged in those papers */
export const QUIET_RULES: readonly string[] = [
	// TeX and Typst fold a run of spaces into one and write dashes as -- and ---, so these flag
	// the source's own way of writing things: two spaces after a full stop, `pages 770--778`
	'Spaces',
	'NoFrenchSpaces',
	'Dashes',
	'NumericRangeEnDash',
	// the vocabulary of a field: softmax (as "soft max"), FLOPs, multi-layer, non-zero, data set,
	// "sentence B" read as bytes, a params column
	'SplitWords',
	'OrthographicConsistency',
	'DisjointPrefixes',
	'CompoundNouns',
	'ExpandMemoryShorthands',
	'ExpandParameter',
	'ExpandMinimum',
	// the words left around a reference or a formula: "Fig.~\ref{a} shows" is a sentence starting
	// with "shows", "Let $x$ be" a misused let's, "the infimum over all $f$" a split overall
	'SentenceCapitalization',
	'LetsConfusion',
	'Overall',
	// a journal's house style, not a mistake: long sentences, the Oxford comma, "Thus we", "more
	// complete", "all of the"
	'LongSentences',
	'OxfordComma',
	'DiscourseMarkers',
	'MoreAdjective',
	'CondenseAllThe'
];

/** the rule that checks spelling; turned off from one word, it would take every word with it */
export const SPELLING_RULE = 'SpellCheck';

/** whether `rule` runs: the reader's own choice, else its default here */
export function ruleIsOn(rule: string, choices: Readonly<Record<string, boolean>>): boolean {
	return choices[rule] ?? !QUIET_RULES.includes(rule);
}

/**
 * Harper's whole rule config: every rule at its own default (null), the quiet ones off, and the
 * reader's choices over both. `rules` is every rule Harper has; a full config replaces the last
 * one, so a rule turned back on returns to its default.
 */
export function ruleConfig(rules: readonly string[], choices: Readonly<Record<string, boolean>>): Record<string, boolean | null> {
	const config: Record<string, boolean | null> = Object.fromEntries(rules.map((r) => [r, null]));
	for (const r of QUIET_RULES) if (r in config) config[r] = false;
	for (const [r, on] of Object.entries(choices)) if (r in config) config[r] = on;
	return config;
}

/**
 * The English of the system's languages: the first English one decides. Harper has no New
 * Zealand, Irish or South African English; those spell as in Britain.
 */
export function systemVariant(languages: readonly string[]): EnglishVariant {
	for (const tag of languages) {
		const [lang, region = ''] = tag.toLowerCase().split(/[-_]/);
		if (lang !== 'en') continue;
		if (region === 'us' || region === '' || region === 'pr' || region === 'ph') return 'american';
		if (region === 'au') return 'australian';
		if (region === 'ca') return 'canadian';
		if (region === 'in') return 'indian';
		return 'british';
	}
	return 'american';
}

/** a rule's name as words: OxfordComma is Oxford Comma */
export function ruleName(rule: string): string {
	return rule.replace(/([a-z\d])([A-Z])|([A-Z])([A-Z][a-z])/g, '$1$3 $2$4');
}
