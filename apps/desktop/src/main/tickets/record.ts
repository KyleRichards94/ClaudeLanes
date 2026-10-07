import {
  TICKET_RECORD_LIMITS,
  TICKET_RECORD_VERSION,
  type Effort,
  type Lane,
  type Model,
  type StageGates,
  type TicketAdoRef,
  type TicketRecord,
} from '@agent-lanes/contracts';

/** What launching a ticket knows (AL-161–AL-165); everything else starts empty. */
export interface NewTicketRecord {
  id: string;
  title: string;
  ado: TicketAdoRef | null;
  repo: string;
  baseBranch: string;
  branch: string;
  worktreePath: string;
  model: Model;
  effort: Effort;
  gates: StageGates;
  skills: string[];
  /** Lane the card starts in; Queued unless given. */
  stage?: Lane;
}

/** A fresh record: no session, sub-branches, builds or design yet. Not validated; the store does that. */
export function createTicketRecord(input: NewTicketRecord, now: number): TicketRecord {
  const stage = input.stage ?? 'queued';
  return {
    version: TICKET_RECORD_VERSION,
    id: input.id,
    title: input.title,
    ado: input.ado === null ? null : { ...input.ado },
    repo: input.repo,
    baseBranch: input.baseBranch,
    branch: input.branch,
    worktreePath: input.worktreePath,
    subBranches: [],
    stage,
    stageHistory: [{ stage, at: now }],
    gates: { ...input.gates },
    model: input.model,
    effort: input.effort,
    skills: [...input.skills],
    sessionId: null,
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Stamps a changed record: `updatedAt` = now, and a stage change gets its timestamp in
 * `stageHistory` (oldest entries dropped past the cap), so callers only set `stage`.
 */
export function stampChange(next: TicketRecord, now: number): TicketRecord {
  const history = next.stageHistory.at(-1)?.stage === next.stage ? next.stageHistory : [...next.stageHistory, { stage: next.stage, at: now }];
  return {
    ...next,
    stageHistory: history.slice(-TICKET_RECORD_LIMITS.stageHistory),
    updatedAt: now,
  };
}

/** When the ticket last entered `stage`, e.g. Done for "Merged into main · 15:20"; undefined if it never did. */
export function stageEnteredAt(record: TicketRecord, stage: Lane): number | undefined {
  return record.stageHistory.findLast((entry) => entry.stage === stage)?.at;
}
