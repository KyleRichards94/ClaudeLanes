import { clockTime, type AgentTicket } from '@/entities/agent-ticket';

/**
 * What the Worktree panel's Build / Run / Stop show for a ticket (AL-173, artboard 3, R8), from the
 * agent ticket store only, so the buttons follow `build:queued`, `build:finished` and `run:status`
 * events wherever the build or run was started (this panel, the agent, another window).
 */
export interface BuildRunControls {
  build: { disabled: boolean; loading: boolean };
  run: { disabled: boolean; loading: boolean };
  /** What Stop stops: the run, else the queued or running build job; null when nothing is active. */
  stop: { target: 'run' | 'job' | null; loading: boolean };
  /** "Last build 14:02 · succeeded", "Build queued · #2", "Building…". */
  buildLine: string;
  /** "Not running", "Starting…", "Running · http://localhost:5080/". */
  runLine: string;
  /** The running app's address, which the run line opens. */
  url: string | null;
  /** The last build failed: the build line is shown in the danger tone. */
  buildFailed: boolean;
  runFailed: boolean;
}

const ACTIVE_RUN = new Set<AgentTicket['run']['state']>(['building', 'starting', 'running', 'stopping']);

export interface BuildRunOptions {
  /** False when the repo has no run command, detected or set (AL-254): Run is off and says so. Undefined while unknown. */
  runCommand?: boolean;
}

export const NO_RUN_COMMAND_LINE = 'No run command';

export function buildRunControls(ticket: Pick<AgentTicket, 'build' | 'run'>, options: BuildRunOptions = {}): BuildRunControls {
  const { job, last } = ticket.build;
  const run = ticket.run;
  const runActive = ACTIVE_RUN.has(run.state);
  const noRunCommand = options.runCommand === false && !runActive;
  const buildJob = job?.kind === 'build' ? job : null;
  const runJob = job?.kind === 'run' ? job : null;

  const buildLine = job
    ? job.state === 'queued'
      ? `${job.kind === 'run' ? 'Run' : 'Build'} queued${job.position ? ` · #${job.position}` : ''}`
      : job.kind === 'run'
        ? 'Building for Run…'
        : 'Building…'
    : last
      ? `Last build ${clockTime(last.finishedAt)} · ${last.outcome}${last.outcome === 'failed' && last.errors > 0 ? ` · ${last.errors} error${last.errors === 1 ? '' : 's'}` : ''}`
      : 'Not built yet';

  const runLine =
    run.state === 'building'
      ? 'Building before it runs…'
      : run.state === 'starting'
        ? 'Starting…'
        : run.state === 'running'
          ? run.url
            ? `Running · ${run.url}`
            : 'Running'
          : run.state === 'stopping'
            ? 'Stopping…'
            : run.state === 'failed'
              ? 'Run failed'
              : noRunCommand
                ? NO_RUN_COMMAND_LINE
                : 'Not running';

  return {
    build: { disabled: job !== null || runActive, loading: buildJob !== null },
    run: { disabled: runActive || job !== null || noRunCommand, loading: runJob !== null || run.state === 'building' || run.state === 'starting' },
    stop: { target: runActive ? 'run' : job ? 'job' : null, loading: run.state === 'stopping' },
    buildLine,
    runLine,
    url: run.state === 'running' ? run.url : null,
    buildFailed: !job && last?.outcome === 'failed',
    runFailed: run.state === 'failed',
  };
}
