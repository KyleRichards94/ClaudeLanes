import { describe, expect, it } from 'vitest';
import type { AgentTicket } from '@/entities/agent-ticket';
import { buildRunControls } from './controls';

type Slice = Pick<AgentTicket, 'build' | 'run'>;

const idle: Slice = { build: { job: null, last: null }, run: { state: 'stopped', url: null, startedAt: null } };
const at1402 = new Date(2026, 9, 7, 14, 2).getTime();

function slice(change: { build?: Partial<Slice['build']>; run?: Partial<Slice['run']> }): Slice {
  return { build: { ...idle.build, ...change.build }, run: { ...idle.run, ...change.run } };
}

describe('Build / Run / Stop state (AL-173)', () => {
  it('offers Build and Run, not Stop, when nothing is going on', () => {
    expect(buildRunControls(idle)).toMatchObject({
      build: { disabled: false, loading: false },
      run: { disabled: false, loading: false },
      stop: { target: null },
      buildLine: 'Not built yet',
      runLine: 'Not running',
      url: null,
    });
  });

  it('turns Run off and says so when the repo has no run command (AL-254)', () => {
    expect(buildRunControls(idle, { runCommand: false })).toMatchObject({ run: { disabled: true, loading: false }, runLine: 'No run command' });
    expect(buildRunControls(idle, { runCommand: true }).run.disabled).toBe(false);
    // While a run is active the line reports the run, whatever the command list says.
    expect(buildRunControls(slice({ run: { state: 'running', url: 'http://localhost:5080/', startedAt: 1 } }), { runCommand: false }).runLine).toBe('Running · http://localhost:5080/');
  });

  it('shows the last build', () => {
    const last = { outcome: 'succeeded', startedAt: at1402 - 60_000, finishedAt: at1402, errors: 0, warnings: 2 } as const;
    expect(buildRunControls(slice({ build: { last } })).buildLine).toBe('Last build 14:02 · succeeded');
    const failed = buildRunControls(slice({ build: { last: { ...last, outcome: 'failed', errors: 3 } } }));
    expect(failed.buildLine).toBe('Last build 14:02 · failed · 3 errors');
    expect(failed.buildFailed).toBe(true);
  });

  it('follows a build job from queued to running, and lets Stop cancel it', () => {
    const queued = buildRunControls(slice({ build: { job: { jobId: 'j1', kind: 'build', state: 'queued', position: 2 } } }));
    expect(queued).toMatchObject({ build: { loading: true }, run: { disabled: true }, stop: { target: 'job' }, buildLine: 'Build queued · #2' });
    const running = buildRunControls(slice({ build: { job: { jobId: 'j1', kind: 'build', state: 'running', position: null } } }));
    expect(running.buildLine).toBe('Building…');
  });

  it('follows a run from starting to running to stopping', () => {
    const starting = buildRunControls(slice({ run: { state: 'starting', startedAt: 1 } }));
    expect(starting).toMatchObject({ build: { disabled: true }, run: { loading: true }, stop: { target: 'run', loading: false }, runLine: 'Starting…' });

    const running = buildRunControls(slice({ run: { state: 'running', url: 'http://localhost:5080/', startedAt: 1 } }));
    expect(running).toMatchObject({ run: { disabled: true, loading: false }, stop: { target: 'run' }, url: 'http://localhost:5080/' });
    expect(running.runLine).toBe('Running · http://localhost:5080/');

    expect(buildRunControls(slice({ run: { state: 'stopping', startedAt: 1 } })).stop).toEqual({ target: 'run', loading: true });
    const failed = buildRunControls(slice({ run: { state: 'failed', startedAt: 1 } }));
    expect(failed).toMatchObject({ run: { disabled: false }, stop: { target: null }, runLine: 'Run failed', runFailed: true });
  });
});
