import { TicketRecordSchema } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { fakeTicketRecord } from '@/shared/testing';
import {
  NO_SUB_AGENTS,
  clampProgress,
  subAgentTotal,
  ticketFromRecord,
  withActivity,
  withBuildJob,
  withGateOpened,
  withGateResolved,
  withLastBuild,
  withModelApplied,
  withModelRequested,
  withNeedsYou,
  withOutputAt,
  withPullRequest,
  withRun,
  withStage,
  withSubAgents,
  withoutNeedsYou,
} from './ticket';

const ticket = () => ticketFromRecord(fakeTicketRecord());

describe('ticketFromRecord', () => {
  it('builds a card from a valid record, with empty live state', () => {
    const record = fakeTicketRecord({ lastBuild: { outcome: 'failed', startedAt: 10, finishedAt: 20, errors: 3, warnings: 0 } });
    expect(TicketRecordSchema.safeParse(record).success).toBe(true);

    expect(ticketFromRecord(record)).toEqual({
      id: '71273',
      title: 'Cutover frmJobControl to Blazor',
      ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 },
      repo: 'C:\\src\\onsite-companion',
      branch: '71273-cutover-frmjobcontrol-to',
      baseBranch: 'main',
      createdAt: 1_000,
      stage: 'implementing',
      stageEnteredAt: 2_000,
      gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
      activity: null,
      progress: null,
      lastOutputAt: null,
      model: 'opus',
      effort: 'xhigh',
      switching: null,
      gate: null,
      needsYou: [],
      subAgents: NO_SUB_AGENTS,
      build: { job: null, last: { outcome: 'failed', startedAt: 10, finishedAt: 20, errors: 3, warnings: 0 } },
      run: { state: 'stopped', url: null, startedAt: null },
      pullRequest: null,
    });
  });

  it('shows a run as running only while its record has no stop time', () => {
    const running = fakeTicketRecord({ lastRun: { startedAt: 5, stoppedAt: null, exitCode: null, url: 'http://localhost:5080' } });
    const stopped = fakeTicketRecord({ lastRun: { startedAt: 5, stoppedAt: 9, exitCode: 0, url: null } });
    expect(ticketFromRecord(running).run).toEqual({ state: 'running', url: 'http://localhost:5080', startedAt: 5 });
    expect(ticketFromRecord(stopped).run).toEqual({ state: 'stopped', url: null, startedAt: 5 });
  });

  it('keeps the live state when the record is loaded again, and the same object when nothing changed', () => {
    let live = ticket();
    live = withActivity(live, { text: 'Editing JobControl.razor', progress: 0.4 }, 50);
    live = withGateOpened(live, 'planning', 60);
    live = withSubAgents(live, { queued: 1, running: 2, done: 0, failed: 0 });

    expect(ticketFromRecord(fakeTicketRecord(), live)).toBe(live);

    const renamed = ticketFromRecord(fakeTicketRecord({ title: 'Renamed' }), live);
    expect(renamed).not.toBe(live);
    expect(renamed).toMatchObject({ title: 'Renamed', activity: live.activity, progress: 0.4, gate: live.gate, subAgents: live.subAgents });
  });

  it('resolves a waiting gate when the reloaded record is in another stage, and clears a switch the record now has', () => {
    let live = withGateOpened(ticket(), 'planning', 60);
    live = withModelRequested(live, { model: 'sonnet' }, 70);

    const next = ticketFromRecord(fakeTicketRecord({ stage: 'code-review', stageEnteredAt: 80, model: 'sonnet' }), live);

    expect(next).toMatchObject({ stage: 'code-review', stageEnteredAt: 80, gate: null, needsYou: [], model: 'sonnet', switching: null });
  });
});

describe('ticket changes', () => {
  it('moves the ticket to another lane and resolves a waiting gate; the same lane is no change', () => {
    const gated = withGateOpened(ticket(), 'code-review', 10);
    expect(withStage(gated, 'implementing', 20)).toBe(gated);

    const moved = withStage(gated, 'code-review', 20);
    expect(moved).toMatchObject({ stage: 'code-review', stageEnteredAt: 20, gate: null, needsYou: [] });
  });

  it('sets activity and clamped progress, and is no change when both are the same', () => {
    const active = withActivity(ticket(), { text: 'Running dotnet test', progress: 1.7 }, 10);
    expect(active).toMatchObject({ activity: { text: 'Running dotnet test', at: 10 }, progress: 1 });
    expect(withActivity(active, { text: 'Running dotnet test', progress: 1 }, 20)).toBe(active);

    // Progress alone keeps the activity's time; leaving progress out keeps it.
    const later = withActivity(active, { text: 'Running dotnet test', progress: 0.5 }, 30);
    expect(later).toMatchObject({ activity: { text: 'Running dotnet test', at: 10 }, progress: 0.5 });
    expect(withActivity(later, { text: 'Reading frmInvoicePrint.vb' }, 40)).toMatchObject({
      activity: { text: 'Reading frmInvoicePrint.vb', at: 40 },
      progress: 0.5,
    });
    expect(withActivity(later, { text: null, progress: null }, 50)).toMatchObject({ activity: null, progress: null });
  });

  it('clamps progress like ProgressBar does', () => {
    expect([clampProgress(-1), clampProgress(0.25), clampProgress(2), clampProgress(Number.NaN), clampProgress(Infinity)]).toEqual([
      0, 0.25, 1, 0, 0,
    ]);
  });

  it('keeps the newest output time and ignores older output', () => {
    const streamed = withOutputAt(ticket(), 100);
    expect(streamed.lastOutputAt).toBe(100);
    expect(withOutputAt(streamed, 90)).toBe(streamed);
    expect(withOutputAt(streamed, 100)).toBe(streamed);
    expect(withOutputAt(streamed, 101).lastOutputAt).toBe(101);
  });

  it('keeps the approval reason in step with the gate', () => {
    const gated = withGateOpened(ticket(), 'planning', 10);
    expect(gated.gate).toEqual({ stage: 'planning', openedAt: 10 });
    expect(gated.needsYou).toEqual([{ kind: 'approval', stage: 'planning', since: 10 }]);
    expect(withGateOpened(gated, 'planning', 20)).toBe(gated);

    const resolved = withGateResolved(gated);
    expect(resolved).toMatchObject({ gate: null, needsYou: [] });
    expect(withGateResolved(resolved)).toBe(resolved);
  });

  it('keeps one needs-you reason per kind, oldest first', () => {
    let next = withNeedsYou(ticket(), { kind: 'qa-gap', gaps: 1, since: 30 });
    next = withGateOpened(next, 'create-pr', 20);
    next = withNeedsYou(next, { kind: 'permission', tool: 'Bash', since: 40 });
    expect(next.needsYou.map((reason) => reason.kind)).toEqual(['approval', 'qa-gap', 'permission']);

    const sameGap = withNeedsYou(next, { kind: 'qa-gap', gaps: 1, since: 30 });
    expect(sameGap).toBe(next);

    next = withNeedsYou(next, { kind: 'qa-gap', gaps: 2, since: 50 });
    expect(next.needsYou).toEqual([
      { kind: 'approval', stage: 'create-pr', since: 20 },
      { kind: 'permission', tool: 'Bash', since: 40 },
      { kind: 'qa-gap', gaps: 2, since: 50 },
    ]);

    next = withoutNeedsYou(next, 'permission');
    expect(next.needsYou.map((reason) => reason.kind)).toEqual(['approval', 'qa-gap']);
    expect(withoutNeedsYou(next, 'permission')).toBe(next);
  });

  it('shows a model switch until the session applies it, and cancels it when the current values are picked again', () => {
    const switching = withModelRequested(ticket(), { model: 'sonnet', effort: 'high' }, 10);
    expect(switching.switching).toEqual({ model: 'sonnet', effort: 'high', requestedAt: 10 });
    expect(switching).toMatchObject({ model: 'opus', effort: 'xhigh' });

    // Changing only the effort keeps the pending model.
    const effortToo = withModelRequested(switching, { effort: 'max' }, 20);
    expect(effortToo.switching).toEqual({ model: 'sonnet', effort: 'max', requestedAt: 20 });
    expect(withModelRequested(effortToo, { effort: 'max' }, 30)).toBe(effortToo);

    expect(withModelRequested(effortToo, { model: 'opus', effort: 'xhigh' }, 40).switching).toBeNull();

    const applied = withModelApplied(effortToo);
    expect(applied).toMatchObject({ model: 'sonnet', effort: 'max', switching: null });
    expect(withModelApplied(applied)).toBe(applied);
  });

  it('keeps a newer pending switch when the session reports an older change applied', () => {
    const switching = withModelRequested(ticket(), { model: 'haiku', effort: 'low' }, 10);
    const applied = withModelApplied(switching, { model: 'sonnet', effort: 'high' });
    expect(applied).toMatchObject({ model: 'sonnet', effort: 'high', switching: { model: 'haiku', effort: 'low' } });
    expect(withModelApplied(applied, { model: 'haiku', effort: 'low' })).toMatchObject({ model: 'haiku', switching: null });
  });

  it('counts sub-agents, flooring bad counts at 0', () => {
    const counted = withSubAgents(ticket(), { queued: 1, running: 2.6, done: -1, failed: Number.NaN });
    expect(counted.subAgents).toEqual({ queued: 1, running: 2, done: 0, failed: 0 });
    expect(subAgentTotal(counted.subAgents)).toBe(3);
    expect(withSubAgents(counted, { queued: 1, running: 2, done: 0, failed: 0 })).toBe(counted);
  });

  it('sets the pull request and is no change for equal values', () => {
    const pr = { id: 10612, status: 'active' as const, checks: { passed: 3, total: 4, pending: 1 } };
    const opened = withPullRequest(ticket(), pr);
    expect(opened.pullRequest).toBe(pr);
    expect(withPullRequest(opened, { ...pr, checks: { ...pr.checks } })).toBe(opened);
    expect(withPullRequest(opened, { ...pr, checks: { passed: 4, total: 4, pending: 0 } }).pullRequest?.checks?.passed).toBe(4);
    expect(withPullRequest(opened, null).pullRequest).toBeNull();
  });

  it('tracks the build queue job and clears it only for the job it shows', () => {
    const queued = withBuildJob(ticket(), { jobId: 'job-1', kind: 'build', state: 'queued', position: 2 });
    expect(queued.build.job).toEqual({ jobId: 'job-1', kind: 'build', state: 'queued', position: 2 });
    expect(withBuildJob(queued, { jobId: 'job-1', kind: 'build', state: 'queued', position: 2 })).toBe(queued);

    const running = withBuildJob(queued, { jobId: 'job-1', kind: 'build', state: 'running', position: null });
    expect(running.build.job).toEqual({ jobId: 'job-1', kind: 'build', state: 'running', position: null });

    expect(withBuildJob(running, { jobId: 'job-0', kind: 'build', state: 'finished', position: null })).toBe(running);
    expect(withBuildJob(running, { jobId: 'job-1', kind: 'build', state: 'cancelled', position: null }).build.job).toBeNull();
  });

  it('sets the last build and the run', () => {
    const last = { outcome: 'succeeded' as const, startedAt: 1, finishedAt: 2, errors: 0, warnings: 2 };
    const built = withLastBuild(ticket(), last);
    expect(built.build.last).toBe(last);
    expect(withLastBuild(built, { ...last })).toBe(built);

    const run = { state: 'running' as const, url: 'http://localhost:5080', startedAt: 3 };
    const running = withRun(built, run);
    expect(running.run).toBe(run);
    expect(withRun(running, { ...run })).toBe(running);
  });
});
