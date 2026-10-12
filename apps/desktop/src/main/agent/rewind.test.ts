import { describe, expect, it, vi } from 'vitest';
import { ok, type AgentTranscript } from '@agent-lanes/contracts';
import { REWIND_PUSHED_REASON, createRewindService } from './rewind';
import { memoryTickets } from './testing/sessions';

async function setup(options: { pushed?: string[]; canRewind?: boolean } = {}) {
  const tickets = await memoryTickets({ id: '71273' });
  const transcript: AgentTranscript = {
    ticketId: '71273',
    lastSeq: 2,
    events: [
      { ticketId: '71273', at: 1_760_000_000_000, seq: 1, item: { kind: 'user', messageId: 'u-1', text: 'Start the grid', priority: null, source: 'composer', parentToolUseId: null } },
      { ticketId: '71273', at: 1_760_000_060_000, seq: 2, item: { kind: 'text', streamId: 'm', text: 'Done', parentToolUseId: null } },
    ],
  };
  const transcripts = { get: vi.fn(async () => transcript), appendSystem: vi.fn() };
  const sessions = { rewindFiles: vi.fn(async () => ok({ canRewind: options.canRewind ?? true, filesChanged: ['src/JobGrid.razor', 'src/JobControl.vb'], insertions: 12, deletions: 3 })) };
  const git = {
    run: vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') return { exitCode: options.pushed ? 0 : 1, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: (options.pushed ?? []).join('\n'), stderr: '' };
    }),
  };
  const service = createRewindService({ sessions, tickets, transcripts, git: git as never, userName: () => 'Kyle' });
  return { service, sessions, transcripts, git };
}

describe('rewind to a message (AL-265)', () => {
  it('previews with a dry run, then rewinds and writes a line to the output', async () => {
    const { service, sessions, transcripts } = await setup();
    await expect(service.rewind({ ticketId: '71273', messageId: 'u-1', dryRun: true })).resolves.toEqual({
      ok: true,
      data: { canRewind: true, error: null, filesChanged: ['src/JobGrid.razor', 'src/JobControl.vb'], insertions: 12, deletions: 3, dryRun: true },
    });
    expect(sessions.rewindFiles).toHaveBeenCalledWith('71273', 'u-1', { dryRun: true });
    expect(transcripts.appendSystem).not.toHaveBeenCalled();

    await expect(service.rewind({ ticketId: '71273', messageId: 'u-1' })).resolves.toMatchObject({ ok: true, data: { canRewind: true, dryRun: false } });
    expect(transcripts.appendSystem).toHaveBeenCalledWith('71273', expect.stringMatching(/^Kyle rewound the worktree to \d\d:\d\d · 2 files restored \(\+12 −3\)$/));
  });

  it('refuses when commits after that message are already pushed, and an unknown message', async () => {
    const { service, sessions } = await setup({ pushed: ['abc123', 'def456'] });
    await expect(service.rewind({ ticketId: '71273', messageId: 'u-1' })).resolves.toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: REWIND_PUSHED_REASON, commits: ['abc123', 'def456'] } });
    expect(sessions.rewindFiles).not.toHaveBeenCalled();
    await expect(service.rewind({ ticketId: '71273', messageId: 'nope' })).resolves.toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'message-unknown' } });
  });
});
