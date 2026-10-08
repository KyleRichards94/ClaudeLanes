import type { BuildDiagnostic, BuildResult } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { BUILD_CONTEXT_MAX_ERRORS, buildContextMessage, createBuildContext } from './build-context';
import { createClaudeLauncher } from './claude-sdk';
import { createSessionManager } from './session-manager';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult } from './testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

const error = (code: string, message: string, line = 1): BuildDiagnostic => ({ severity: 'error', code, message, file: 'JobControl.razor.cs', line, column: 17 });

function failedBuild(overrides: Partial<BuildResult> = {}): BuildResult {
  return {
    jobId: 'job-1',
    ticketId: '71273',
    kind: 'build',
    outcome: 'failed',
    command: 'dotnet build OnSite.sln -c Debug',
    exitCode: 1,
    errors: 2,
    warnings: 1,
    diagnostics: [
      error('CS0246', "The type or namespace name 'JobFilterState' could not be found", 42),
      error('CS0103', "The name 'grid' does not exist in the current context", 8),
      { severity: 'warning', code: 'CS0168', message: "The variable 'e' is declared but never used", file: 'Filters.cs', line: 1, column: 1 },
    ],
    startedAt: 1_000,
    finishedAt: 2_000,
    ...overrides,
  };
}

async function setup() {
  const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')], onSend: (message) => (message.shouldQuery === false ? [] : [fakeAssistant('On it'), fakeResult()]) });
  const tickets = await memoryTickets({ id: '71273' });
  const sessions = createSessionManager({
    claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
    connections: fakeClaudeConnections(),
    tickets,
    emit: recordingEmit().emit,
    watchdogMs: 0,
  });
  return { fake, sessions, context: createBuildContext({ sessions }) };
}

describe('build result as next-turn context (AL-112)', () => {
  it('rides a failed build the user started along with the next turn, without starting one', async () => {
    const { fake, sessions, context } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => sessions.status('71273').state === 'idle');
    const call = fake.calls[0]!;

    context.onBuildFinished(failedBuild());
    await call.sentCount(2);
    const pushed = call.sent[1]!;
    expect(pushed.shouldQuery).toBe(false);
    expect(pushed.priority).toBe('next');
    const text = pushed.message.content as string;
    expect(text).toContain('`dotnet build OnSite.sln -c Debug` failed (exit code 1) with 2 errors and 1 warning.');
    expect(text).toContain("- JobControl.razor.cs(42,17): CS0246: The type or namespace name 'JobFilterState' could not be found");
    expect(text).toContain("- JobControl.razor.cs(8,17): CS0103: The name 'grid' does not exist in the current context");
    expect(text).not.toContain('CS0168');
    // No turn started: the session waits for the user, and the result is in its conversation.
    expect(sessions.status('71273').state).toBe('idle');

    // The user's next message starts the turn that sees the result.
    expect(sessions.send('71273', { text: 'Fix the build' }).ok).toBe(true);
    await call.sentCount(3);
    expect(call.sent.map((message) => message.shouldQuery ?? true)).toEqual([true, false, true]);
    await sessions.dispose();
  });

  it('lists the first N errors and counts the rest', () => {
    const many = Array.from({ length: 14 }, (_, index) => error('CS1002', '; expected', index + 1));
    const text = buildContextMessage(failedBuild({ errors: 14, diagnostics: many }))!;
    expect(text).toContain(`First ${BUILD_CONTEXT_MAX_ERRORS} of 14 errors:`);
    expect(text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(BUILD_CONTEXT_MAX_ERRORS);
  });

  it('reports a successful build, a Run build step, and says nothing about a cancelled one', () => {
    expect(buildContextMessage(failedBuild({ outcome: 'succeeded', exitCode: 0, errors: 0, warnings: 0, diagnostics: [] }))).toContain(
      '`dotnet build OnSite.sln -c Debug` succeeded with 0 errors and 0 warnings.',
    );
    expect(buildContextMessage(failedBuild({ kind: 'run' }))).toContain('The build step of a Run the user started');
    expect(buildContextMessage(failedBuild({ outcome: 'cancelled', exitCode: null }))).toBeNull();
  });

  it('sends nothing when the ticket has no live session', async () => {
    const { fake, sessions, context } = await setup();
    context.onBuildFinished(failedBuild());
    expect(fake.calls).toHaveLength(0);
    expect(sessions.status('71273').state).toBe('none');
  });

  it('holds the result for a paused session and delivers it on Resume without starting a turn', async () => {
    const { fake, sessions, context } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => sessions.status('71273').state === 'idle');
    await sessions.pause('71273');
    context.onBuildFinished(failedBuild());
    expect(fake.calls[0]!.sent).toHaveLength(1);
    sessions.resume('71273');
    await fake.calls[0]!.sentCount(2);
    expect(fake.calls[0]!.sent[1]!.shouldQuery).toBe(false);
    expect(sessions.status('71273').state).toBe('idle');
    await sessions.dispose();
  });
});
