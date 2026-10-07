import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TicketRecord } from '@agent-lanes/contracts';

/** When the e2e ticket was created; its stages follow a minute later and twelve minutes after that. */
export const E2E_TICKET_START = 1_760_000_000_000;

/**
 * Ticket 71273 in Implementing, as AL-101 writes it: Opus · XHigh, session cc-71273, Planning took
 * 12 minutes. Pass overrides for other tickets or stages.
 */
export function e2eTicketRecord(overrides: Partial<TicketRecord> = {}): TicketRecord {
  const start = E2E_TICKET_START;
  return {
    version: 1,
    id: '71273',
    title: 'Cutover frmJobControl to Blazor',
    ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 },
    repo: 'C:\\src\\onsite-companion',
    baseBranch: 'main',
    branch: '71273-cutover-job-control',
    worktreePath: 'C:\\src\\.agent-lanes\\71273',
    subBranches: [],
    stage: 'implementing',
    stageHistory: [
      { stage: 'queued', at: start },
      { stage: 'planning', at: start + 60_000 },
      { stage: 'implementing', at: start + 13 * 60_000 },
    ],
    gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
    model: 'opus',
    effort: 'xhigh',
    skills: [],
    sessionId: 'cc-71273',
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    createdAt: start,
    updatedAt: start + 13 * 60_000,
    ...overrides,
  };
}

/** Writes records where the app reads them at start-up (`<userData>/tickets/<repoKey>/<id>.json`). */
export function seedTicketRecords(userDataDir: string, records: readonly TicketRecord[]): void {
  const folder = join(userDataDir, 'tickets', 'onsite-companion-0123456789ab');
  mkdirSync(folder, { recursive: true });
  for (const record of records) writeFileSync(join(folder, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
}
