// The preload's optional git halves, one type per client module, joined here so the bridge type in
// fileSystem.ts names them once. Each is optional throughout: an older preload lacks it, and the
// feature it backs is simply not offered.
import type { GitRemoteBridge } from './git';
import type { GitCombineBridge } from './gitCombine';
import type { GitCloneBridge } from './gitClone';
import type { GitVersionBridge } from './gitVersion';
import type { GitBranchBridge } from './gitBranches';
import type { GitMilestoneBridge } from './gitMilestones';
import type { GithubForkBridge } from './githubFork';
import type { GitTrustBridge } from './gitTrust';
import type { GitFetchBridge } from './scmFetch.svelte';
import type { LocalHistoryBridge } from './localHistory.svelte';

export type GitBridges = GitRemoteBridge &
	GitCombineBridge &
	GitCloneBridge &
	GitVersionBridge &
	GitBranchBridge &
	GitMilestoneBridge &
	GithubForkBridge &
	GitTrustBridge &
	GitFetchBridge &
	LocalHistoryBridge;
