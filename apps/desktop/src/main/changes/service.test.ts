import { err, ok, type AgentOutputEvent, type DiffFile, type GitDiff, type Result } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { eventLog, lines } from '../agent/testing/output-events';
import { memoryTickets } from '../agent/testing/sessions';
import { parseStatusV2 } from '../git/porcelain';
import { handleInvoke } from '../ipc/handle-invoke';
import { createChangesHandlers } from './handlers';
import { createChangesService } from './service';

const LEAD = '71273';
const REVIEWER = '71273-reviewer-eyes';
const HELPER = '71273-helper-docs';

const row = (overrides: Partial<DiffFile> & Pick<DiffFile, 'path'>): DiffFile => ({ oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false, ...overrides });

function diffOf(files: DiffFile[], overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    ticketId: LEAD,
    against: { kind: 'base' },
    fromRef: 'main',
    fromCommit: 'abc123',
    toRef: '71273-cutover-frmjobcontrol-to',
    includesUncommitted: true,
    files,
    truncated: false,
    totals: { files: files.length, additions: 0, deletions: 0 },
    ...overrides,
  };
}

function block(file: string, status: string, findings: unknown[] = []): string {
  return `\`\`\`json\n${JSON.stringify({ file, status, findings })}\n\`\`\``;
}

async function setup(options: { diff?: Result<GitDiff>; stage?: 'implementing' | 'code-review'; statusFails?: boolean } = {}) {
  const tickets = await memoryTickets(
    { id: LEAD },
    { id: REVIEWER, companion: { of: LEAD, role: 'reviewer', name: 'Eyes' } },
    { id: HELPER, companion: { of: LEAD, role: 'helper', name: 'Docs' } },
    // Another ticket's transcript is never read for this one.
    { id: '71274' },
  );
  await tickets.update(LEAD, (record) => ({ ...record, stage: options.stage ?? 'implementing' }));

  const lead = eventLog(LEAD, 1_000);
  const reviewer = eventLog(REVIEWER, 2_000);
  const helper = eventLog(HELPER, 3_000);
  const transcripts: Record<string, { events: AgentOutputEvent[]; lastSeq: number }> = {};
  const get = vi.fn(async (ticketId: string) => ({ ticketId, events: [...(transcripts[ticketId]?.events ?? [])], lastSeq: transcripts[ticketId]?.lastSeq ?? 0 }));
  const sync = () => {
    for (const [id, log] of [[LEAD, lead], [REVIEWER, reviewer], [HELPER, helper]] as const) transcripts[id] = { events: log.events, lastSeq: log.events.length };
  };
  const files = vi.fn(async () => options.diff ?? ok(diffOf([])));
  const status = vi.fn(async () => {
    if (options.statusFails) throw new Error('index.lock');
    return parseStatusV2(['1 .M N... 100644 100644 100644 aaa bbb src/Grid.razor', '? notes.md', ''].join('\0'));
  });
  const warn = vi.fn();
  const service = createChangesService({ diffs: { files }, git: { status }, tickets, transcripts: { get }, log: { warn } });
  const handlers = createChangesHandlers({ changes: service });
  return { tickets, lead, reviewer, helper, sync, get, files, status, warn, service, handlers };
}

describe('changes service: diff:files (AL-276)', () => {
  it('lists the ticket files with authors from the lead, a sub-agent and a second agent, uncommitted and review status', async () => {
    const { service, lead, helper, reviewer, sync, files, status } = await setup({
      stage: 'code-review',
      diff: ok(diffOf([row({ path: 'src/Grid.razor', additions: 120 }), row({ path: 'docs/Grid.md', status: 'added', additions: 12 }), row({ path: 'src/Other.cs' }), row({ path: 'notes.md', status: 'untracked', additions: 3 })])),
    });
    lead.edit('t1', 'src/Grid.razor', lines(20));
    lead.edit('t2', 'src/Grid.razor', lines(60), 'toolu_razor');
    helper.write('h1', 'docs/Grid.md', lines(12));
    reviewer.text(block('src/Grid.razor', 'changesRequested', [{ line: 4, severity: 'warn', text: 'Check it.' }]));
    reviewer.read('r1', 'src/Other.cs');
    sync();

    const result = await service.files(LEAD);

    expect(result).toEqual({
      ok: true,
      data: {
        ticketId: LEAD,
        base: 'main',
        head: '71273-cutover-frmjobcontrol-to',
        truncated: false,
        files: [
          { path: 'src/Grid.razor', oldPath: null, kind: 'modified', added: 120, removed: 0, authorAgentId: 'toolu_razor', touchedBy: [LEAD, 'toolu_razor'], uncommitted: true },
          { path: 'docs/Grid.md', oldPath: null, kind: 'added', added: 12, removed: 0, authorAgentId: HELPER, touchedBy: [HELPER], uncommitted: false },
          { path: 'src/Other.cs', oldPath: null, kind: 'modified', added: 1, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: false },
          { path: 'notes.md', oldPath: null, kind: 'added', added: 3, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: true },
        ],
        reviewStatus: { 'src/Grid.razor': 'changesRequested', 'docs/Grid.md': 'notReviewed', 'src/Other.cs': 'inReview', 'notes.md': 'notReviewed' },
      },
    });
    expect(files).toHaveBeenCalledWith(LEAD, { kind: 'base' });
    expect(status).toHaveBeenCalledWith(expect.stringContaining(LEAD), { untracked: 'all' });
  });

  it('does not read the working tree when the worktree is gone, and survives a failing git status', async () => {
    const gone = await setup({ diff: ok(diffOf([row({ path: 'src/Grid.razor' })], { includesUncommitted: false })) });
    const result = await gone.service.files(LEAD);
    expect(gone.status).not.toHaveBeenCalled();
    expect(result.ok && result.data.files[0]?.uncommitted).toBe(false);

    const failing = await setup({ statusFails: true, diff: ok(diffOf([row({ path: 'src/Grid.razor' })])) });
    const failed = await failing.service.files(LEAD);
    expect(failed.ok && failed.data.files[0]?.uncommitted).toBe(false);
    expect(failing.warn).toHaveBeenCalledWith(expect.stringContaining('index.lock'));
  });

  it('refreshes when a transcript moves on, and the lead only shows a file in review during Code review', async () => {
    const { service, lead, sync, tickets } = await setup({ diff: ok(diffOf([row({ path: 'src/Grid.razor' })])) });
    sync();
    const before = await service.files(LEAD);
    expect(before.ok && before.data.files[0]?.authorAgentId).toBeNull();

    lead.edit('t1', 'src/Grid.razor', lines(3));
    lead.read('r1', 'src/Grid.razor');
    sync();
    const after = await service.files(LEAD);
    expect(after.ok && after.data.files[0]?.authorAgentId).toBe(LEAD);
    expect(after.ok && after.data.reviewStatus['src/Grid.razor']).toBe('notReviewed');

    await tickets.update(LEAD, (record) => ({ ...record, stage: 'code-review' }));
    const reviewing = await service.files(LEAD);
    expect(reviewing.ok && reviewing.data.reviewStatus['src/Grid.razor']).toBe('inReview');
  });

  it('passes a git:diff refusal on and refuses an unknown ticket', async () => {
    const refused = await setup({ diff: err('VALIDATION', 'The base branch main was not found.', { reason: 'base-not-found' }) });
    await expect(refused.service.files(LEAD)).resolves.toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'base-not-found' } });

    const { service, files } = await setup();
    await expect(service.files('nope')).resolves.toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'ticket-not-found', ticketId: 'nope' } });
    expect(files).not.toHaveBeenCalled();
  });

  it('answers INTERNAL instead of throwing when a transcript cannot be read', async () => {
    const { service, get } = await setup({ diff: ok(diffOf([])) });
    get.mockRejectedValueOnce(new Error('disk gone'));
    await expect(service.files(LEAD)).resolves.toMatchObject({ ok: false, code: 'INTERNAL' });
  });
});

describe('changes service: review:findings (AL-277)', () => {
  it("returns the reviewer's and the lead's findings with stable ids", async () => {
    const { service, lead, reviewer, sync } = await setup();
    reviewer.text(`Looked at the grid.\n${block('src/Grid.razor', 'changesRequested', [{ line: 12, severity: 'error', text: 'Crashes on an empty grid.' }])}`);
    lead.text(block('src/Other.cs', 'passed', [{ line: 3, severity: 'info', text: 'Fine.' }]));
    reviewer.text('```json\n{"file": "broken.cs", "status": \n```');
    sync();

    const result = await service.findings(LEAD);
    expect(result).toEqual({
      ok: true,
      data: [
        { id: `${LEAD}:src/Other.cs:3:0`, filePath: 'src/Other.cs', line: 3, severity: 'info', text: 'Fine.', agentId: LEAD },
        { id: `${REVIEWER}:src/Grid.razor:12:0`, filePath: 'src/Grid.razor', line: 12, severity: 'error', text: 'Crashes on an empty grid.', agentId: REVIEWER },
      ],
    });
    await expect(service.findings(LEAD)).resolves.toEqual(result);
  });

  it('refuses an unknown ticket', async () => {
    const { service } = await setup();
    await expect(service.findings('nope')).resolves.toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'ticket-not-found' } });
  });
});

describe('changes IPC handlers', () => {
  it('diff:files and review:findings answer through their contracts', async () => {
    const { handlers, lead, reviewer, sync } = await setup({ diff: ok(diffOf([row({ path: 'src/Grid.razor', additions: 4 })])) });
    lead.edit('t1', 'src/Grid.razor', lines(4));
    reviewer.text(block('src/Grid.razor', 'passed'));
    sync();

    const files = await handleInvoke('diff:files', { ticketId: LEAD }, handlers['diff:files']);
    expect(files).toMatchObject({ ok: true, data: { ticketId: LEAD, files: [{ path: 'src/Grid.razor', authorAgentId: LEAD }], reviewStatus: { 'src/Grid.razor': 'passed' } } });
    await expect(handleInvoke('review:findings', { ticketId: LEAD }, handlers['review:findings'])).resolves.toEqual({ ok: true, data: [] });
    await expect(handleInvoke('diff:files', { ticketId: '' }, handlers['diff:files'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(handleInvoke('review:findings', { ticketId: 'nope' }, handlers['review:findings'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'ticket-not-found' } });
  });
});
