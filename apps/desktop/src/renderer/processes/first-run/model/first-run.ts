import type { ConnectionSummary, RepoSettings } from '@agent-lanes/contracts';

/**
 * Where first run stands (AL-047, design §8, §5 Processes):
 * - `connect`: no Azure DevOps organisation or no Claude connection is saved; the Connections modal
 *   opens blocking. Saving needs a passed Test connection, so a saved row was connected when it was saved;
 *   one that fails later is a Reconnect (AL-048), not first run again.
 * - `repo`: connected, but no repo is chosen (or the last one is no longer registered).
 * - `done`: the board, for the last repo.
 */
export type FirstRunStep = 'connect' | 'repo' | 'done';

export interface FirstRunInputs {
  connections: readonly ConnectionSummary[];
  repos: readonly RepoSettings[];
  lastRepo: string | null;
}

export function firstRunStep({ connections, repos, lastRepo }: FirstRunInputs): FirstRunStep {
  const hasAdo = connections.some((row) => row.kind === 'ado');
  const hasClaude = connections.some((row) => row.kind === 'claude');
  if (!hasAdo || !hasClaude) return 'connect';
  if (!lastRepo || !repos.some((repo) => repo.path === lastRepo)) return 'repo';
  return 'done';
}

/**
 * The e2e suite opens most specs straight on the board: main adds `?firstRun=skip` to the page when
 * `AGENT_LANES_SKIP_FIRST_RUN=1` in an unpackaged build (never in the installed app).
 */
export function isFirstRunSkipped(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('firstRun') === 'skip';
}
