// A branch name typed the way a writer would is made into one git accepts, as VS Code does with its
// default git.branchWhitespaceChar, instead of being refused.
import { it, expect } from 'vitest';
import { branchNameFrom } from '$lib/workspace/gitBranches';

it('turns spaces and what git forbids into dashes', () => {
	expect(branchNameFrom('camera ready')).toBe('camera-ready');
	expect(branchNameFrom('  reviewer 2: round 1 ')).toBe('reviewer-2--round-1');
	expect(branchNameFrom('--draft')).toBe('draft');
	expect(branchNameFrom('notes.lock')).toBe('notes-');
	expect(branchNameFrom('chapter-3')).toBe('chapter-3');
	expect(branchNameFrom('   ')).toBe('');
});
