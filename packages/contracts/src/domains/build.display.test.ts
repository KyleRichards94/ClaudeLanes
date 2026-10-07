import { describe, expect, it } from 'vitest';
import { invokeContracts, eventContracts } from '../schemas';
import { buildCardState, buildFailedLabel, diagnosticActivity, lastBuildLabel, runLabel, runUrlHost, shortDiagnosticMessage } from './build.display';
import { BuildLogEventSchema, BuildResultSchema, type BuildDiagnostic } from './build.schemas';
import { TicketLastBuildSchema } from './tickets.schemas';

const cs0246: BuildDiagnostic = {
  severity: 'error',
  code: 'CS0246',
  message: "The type or namespace name 'JobFilterState' could not be found (are you missing a using directive or an assembly reference?)",
  file: 'OnSite/JobControl.razor.cs',
  line: 42,
  column: 17,
};

describe('build card text (artboard 6)', () => {
  it('shows "Build failed · 3 errors" and the first error as the activity', () => {
    expect(buildCardState({ outcome: 'failed', errors: 3, firstError: cs0246 })).toEqual({
      footer: 'Build failed · 3 errors',
      activity: 'CS0246: JobFilterState not found',
    });
  });

  it('has no build state unless the last build failed', () => {
    expect(buildCardState(null)).toBeNull();
    expect(buildCardState({ outcome: 'succeeded', errors: 0, firstError: null })).toBeNull();
    expect(buildCardState({ outcome: 'cancelled', errors: 0, firstError: null })).toBeNull();
  });

  it('counts one error in the singular and none without a count', () => {
    expect(buildFailedLabel(1)).toBe('Build failed · 1 error');
    expect(buildFailedLabel(0)).toBe('Build failed');
    expect(buildCardState({ outcome: 'failed', errors: 0, firstError: null })).toEqual({ footer: 'Build failed', activity: null });
  });

  it('shortens missing-name messages and drops the compiler hint', () => {
    expect(shortDiagnosticMessage("The name 'grid' does not exist in the current context")).toBe('grid not found');
    expect(shortDiagnosticMessage("Cannot find name 'useGrid'.")).toBe('useGrid not found');
    expect(shortDiagnosticMessage("'Foo' does not contain a definition for 'Bar' (are you missing a using directive?)")).toBe(
      "'Foo' does not contain a definition for 'Bar'",
    );
    expect(diagnosticActivity({ code: null, message: 'Something broke' })).toBe('Something broke');
  });

  it('says when the last build ran and how it went', () => {
    const at = new Date(2026, 9, 7, 14, 2).getTime();
    expect(lastBuildLabel({ outcome: 'succeeded', errors: 0, finishedAt: at })).toBe('Last build 14:02 · succeeded');
    expect(lastBuildLabel({ outcome: 'failed', errors: 3, finishedAt: at })).toBe('Last build 14:02 · failed · 3 errors');
    expect(lastBuildLabel({ outcome: 'cancelled', errors: 0, finishedAt: at }, () => '9:05')).toBe('Last build 9:05 · cancelled');
    expect(lastBuildLabel(null)).toBeNull();
  });
});

describe('build contracts (AL-132)', () => {
  it('declares build:start and build:finished', () => {
    expect(invokeContracts['build:start'].request.safeParse({ ticketId: '71273' }).success).toBe(true);
    expect(invokeContracts['build:start'].request.safeParse({ ticketId: '71273', path: 'C:\\' }).success).toBe(false);
    expect(eventContracts['build:finished']).toBeDefined();
  });

  it('reads a record written before firstError existed', () => {
    expect(TicketLastBuildSchema.parse({ outcome: 'succeeded', startedAt: 1, finishedAt: 2, errors: 0, warnings: 0 }).firstError ?? null).toBeNull();
  });

  it('refuses an empty log batch and lines that are too long', () => {
    const base = { ticketId: '71273', at: 1, jobId: 'j1', kind: 'build' };
    expect(BuildLogEventSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(BuildLogEventSchema.safeParse({ ...base, lines: [{ text: 'x'.repeat(4001), stream: 'stdout', level: 'info' }] }).success).toBe(false);
    expect(BuildLogEventSchema.safeParse({ ...base, lines: [{ text: 'ok', stream: 'stderr', level: 'error' }] }).success).toBe(true);
    // The AL-012 envelope still applies: no ticket id, no event.
    expect(BuildLogEventSchema.safeParse({ ...base, ticketId: undefined, lines: [{ text: 'ok', stream: 'stdout', level: 'info' }] }).success).toBe(false);
  });

  it('describes a failed result with its counts', () => {
    const result = BuildResultSchema.parse({
      jobId: 'j1',
      ticketId: '71273',
      kind: 'build',
      outcome: 'failed',
      command: 'dotnet build OnSite.sln -c Debug',
      exitCode: 1,
      errors: 3,
      warnings: 2,
      diagnostics: [cs0246],
      startedAt: 1,
      finishedAt: 2,
    });
    expect(result.errors).toBe(3);
  });
});

describe('run label (AL-133)', () => {
  it('shows "Running · localhost:5080" for a web app and "Running" for a desktop app', () => {
    expect(runLabel({ state: 'running', url: 'http://localhost:5080/' })).toBe('Running · localhost:5080');
    expect(runLabel({ state: 'running', url: null })).toBe('Running');
    expect(runUrlHost('https://127.0.0.1:7001/swagger?x=1')).toBe('127.0.0.1:7001');
  });

  it('says what a run is doing, and "Not running" without one', () => {
    expect(runLabel(null)).toBe('Not running');
    expect(runLabel({ state: 'building', url: null })).toBe('Building…');
    expect(runLabel({ state: 'starting', url: null })).toBe('Starting…');
    expect(runLabel({ state: 'stopping', url: 'http://localhost:5080/' })).toBe('Stopping…');
    expect(runLabel({ state: 'stopped', url: 'http://localhost:5080/' })).toBe('Not running');
    expect(runLabel({ state: 'failed', url: null })).toBe('Run failed');
  });

  it('declares run:start, run:list and run:openUrl, and a full run:status payload', () => {
    expect(invokeContracts['run:start'].request.safeParse({ ticketId: '71273' }).success).toBe(true);
    expect(invokeContracts['run:list'].response.safeParse({ runs: [] }).success).toBe(true);
    expect(invokeContracts['run:openUrl'].response.safeParse({ opened: true }).success).toBe(true);
    const status = {
      ticketId: '71273',
      runId: 'r1',
      state: 'running',
      runKind: 'web',
      port: 5080,
      url: 'http://localhost:5080/',
      startedAt: 1,
      stoppedAt: null,
      exitCode: null,
      message: null,
    };
    expect(eventContracts['run:status'].safeParse({ ...status, at: 2 }).success).toBe(true);
    expect(eventContracts['run:status'].safeParse({ ...status, ticketId: undefined, at: 2 }).success).toBe(false);
    expect(eventContracts['run:status'].safeParse({ ...status, port: 70_000, at: 2 }).success).toBe(false);
  });
});
