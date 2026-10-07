import { TICKET_RECORD_VERSION, defaultStageGates, type Lane, type TicketRecord } from '@agent-lanes/contracts';

/**
 * A valid ticket record (AL-101) for renderer tests: ticket 71273 "Cutover frmJobControl to Blazor"
 * in Implementing, Opus · XHigh, created at t = 1,000 and in its lane since t = 2,000. `id` also sets
 * the work item id and branch when they are not given.
 */
export function fakeTicketRecord(overrides: Partial<TicketRecord> & { stage?: Lane; stageEnteredAt?: number } = {}): TicketRecord {
  const { stageEnteredAt, ...fields } = overrides;
  const id = fields.id ?? '71273';
  const workItemId = /^\d+$/.test(id) ? Number(id) : 71273;
  const createdAt = fields.createdAt ?? 1_000;
  const stage = fields.stage ?? 'implementing';
  const enteredAt = stageEnteredAt ?? 2_000;
  return {
    version: TICKET_RECORD_VERSION,
    id,
    title: 'Cutover frmJobControl to Blazor',
    ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId },
    repo: 'C:\\src\\onsite-companion',
    baseBranch: 'main',
    branch: `${id}-cutover-frmjobcontrol-to`,
    worktreePath: `C:\\src\\.agent-lanes\\${id}`,
    subBranches: [],
    stageHistory:
      stage === 'queued'
        ? [{ stage, at: enteredAt }]
        : [
            { stage: 'queued', at: createdAt },
            { stage, at: enteredAt },
          ],
    gates: defaultStageGates(),
    model: 'opus',
    effort: 'xhigh',
    skills: [],
    sessionId: null,
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    updatedAt: enteredAt,
    ...fields,
    stage,
    createdAt,
  };
}
