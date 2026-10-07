import { describe, expect, it } from 'vitest';
import { TicketEventEnvelopeSchema, TicketIdSchema } from '../events';
import { defaultStageGates } from './settings.schemas';
import { TICKET_RECORD_LIMITS, TICKET_RECORD_VERSION, TicketRecordSchema, type TicketRecord } from './tickets.schemas';

const at = 1_760_000_000_000;

function record(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    version: TICKET_RECORD_VERSION,
    id: '71273',
    title: 'Cutover frmJobControl to Blazor',
    ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 },
    repo: 'C:\\src\\onsite-companion',
    baseBranch: 'main',
    branch: '71273-cutover-frmjobcontrol-to',
    worktreePath: 'C:\\src\\.agent-lanes\\71273',
    subBranches: [
      {
        name: 'grid',
        branch: 'sub/71273-grid',
        worktreePath: 'C:\\src\\.agent-lanes\\71273--grid',
        createdAt: at + 10,
        mergedAt: null,
      },
    ],
    stage: 'implementing',
    stageHistory: [
      { stage: 'queued', at },
      { stage: 'planning', at: at + 1 },
      { stage: 'implementing', at: at + 2 },
    ],
    gates: defaultStageGates(),
    model: 'opus',
    effort: 'xhigh',
    skills: ['code-review'],
    sessionId: 'cc-71273',
    lastBuild: { outcome: 'failed', startedAt: at + 3, finishedAt: at + 4, errors: 3, warnings: 2 },
    lastRun: { startedAt: at + 5, stoppedAt: null, exitCode: null, url: 'http://localhost:5080' },
    design: {
      canvas: { kind: 'design-project', id: 'abc123', url: 'https://claude.ai/design/p/abc123' },
      lastViewUrl: 'https://claude.ai/design/p/abc123?artboard=2',
      specs: [
        { version: 1, shippedAt: at + 6, approvedBy: 'Kyle', artboardCount: 2, usedAt: at + 7 },
        { version: 2, shippedAt: at + 8, approvedBy: 'Kyle', artboardCount: 1, usedAt: null },
      ],
    },
    createdAt: at,
    updatedAt: at + 8,
    ...overrides,
  };
}

describe('TicketIdSchema', () => {
  it.each(['71273', 'nt-20261007-fix-login', 'nt-20261007-fix-login-2', 'cc-71273', 'com10', 'console'])('accepts %s', (id) => {
    expect(TicketIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['upper case (Windows file names ignore case)', 'AL-2'],
    ['a path', '../71273'],
    ['a separator', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a dot', '71273.json'],
    ['a space', 'nt 1'],
    ['a leading dash', '-71273'],
    ['a trailing dash', '71273-'],
    ['a double dash (sub-agent worktree folders use it)', '71273--grid'],
    ['a Windows device name', 'con'],
    ['another device name', 'nul'],
    ['a numbered device name', 'com1'],
    ['a printer device name', 'lpt9'],
    ['too long', 'a'.repeat(65)],
  ])('refuses %s', (_case, id) => {
    expect(TicketIdSchema.safeParse(id).success).toBe(false);
  });

  it('is what ticket events carry', () => {
    expect(TicketEventEnvelopeSchema.safeParse({ ticketId: '71273', at }).success).toBe(true);
    expect(TicketEventEnvelopeSchema.safeParse({ ticketId: '../71273', at }).success).toBe(false);
  });
});

describe('TicketRecordSchema', () => {
  it('accepts a full record and survives a JSON round trip unchanged', () => {
    const value = record();
    const parsed = TicketRecordSchema.parse(JSON.parse(JSON.stringify(value)));
    expect(parsed).toEqual(value);
  });

  it('accepts a fresh "No ticket" record with nothing filled in yet', () => {
    const fresh = record({
      id: 'nt-20261007-fix-login',
      ado: null,
      subBranches: [],
      stage: 'queued',
      stageHistory: [{ stage: 'queued', at }],
      skills: [],
      sessionId: null,
      lastBuild: null,
      lastRun: null,
      design: { canvas: null, lastViewUrl: null, specs: [] },
    });
    expect(TicketRecordSchema.safeParse(fresh).success).toBe(true);
  });

  it('needs the last stage history entry to be the current stage', () => {
    const result = TicketRecordSchema.safeParse(record({ stage: 'qa' }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['stageHistory']);
    expect(TicketRecordSchema.safeParse(record({ stageHistory: [] })).success).toBe(false);
  });

  it('refuses a record from another version', () => {
    expect(TicketRecordSchema.safeParse({ ...record(), version: 2 }).success).toBe(false);
  });

  it('refuses an unsafe id, unknown stage, model or effort', () => {
    expect(TicketRecordSchema.safeParse(record({ id: '..\\evil' })).success).toBe(false);
    expect(TicketRecordSchema.safeParse({ ...record(), stage: 'reviewing' }).success).toBe(false);
    expect(TicketRecordSchema.safeParse({ ...record(), model: 'gpt' }).success).toBe(false);
    expect(TicketRecordSchema.safeParse({ ...record(), effort: 'huge' }).success).toBe(false);
  });

  it('needs every stage in the gates', () => {
    const { qa: _qa, ...gates } = defaultStageGates();
    expect(TicketRecordSchema.safeParse({ ...record(), gates }).success).toBe(false);
  });

  it('refuses duplicate skills and sub-branches', () => {
    expect(TicketRecordSchema.safeParse(record({ skills: ['code-review', 'code-review'] })).success).toBe(false);
    const sub = record().subBranches[0];
    expect(sub).toBeDefined();
    if (sub) expect(TicketRecordSchema.safeParse(record({ subBranches: [sub, { ...sub, name: 'other' }] })).success).toBe(false);
  });

  it('needs design spec versions to increase', () => {
    const [v1, v2] = record().design.specs;
    if (!v1 || !v2) throw new Error('fixture');
    const design = { ...record().design, specs: [v2, v1] };
    expect(TicketRecordSchema.safeParse(record({ design })).success).toBe(false);
    expect(TicketRecordSchema.safeParse(record({ design: { ...design, specs: [v1, { ...v2, version: 1 }] } })).success).toBe(false);
  });

  it('keeps the design view on claude.ai', () => {
    const design = { ...record().design, lastViewUrl: 'https://evil.example/design' };
    expect(TicketRecordSchema.safeParse(record({ design })).success).toBe(false);
  });

  it('caps the lists that grow while a ticket runs', () => {
    const history = Array.from({ length: TICKET_RECORD_LIMITS.stageHistory + 1 }, (_, i) => ({ stage: 'implementing' as const, at: at + i }));
    expect(TicketRecordSchema.safeParse(record({ stageHistory: history })).success).toBe(false);
    expect(TicketRecordSchema.safeParse(record({ stageHistory: history.slice(1) })).success).toBe(true);
  });
});
