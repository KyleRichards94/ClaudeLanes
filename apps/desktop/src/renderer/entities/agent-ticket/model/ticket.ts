import {
  STAGES,
  type BuildJob,
  type Effort,
  type Lane,
  type Model,
  type Stage,
  type TicketLastBuild,
  type TicketRecord,
} from '@agent-lanes/contracts';
import {
  SUB_AGENT_STATES,
  type AgentTicket,
  type AgentTicketBuildJob,
  type AgentTicketPullRequest,
  type AgentTicketRun,
  type NeedsYouReason,
  type OtherNeedsYouKind,
  type OtherNeedsYouReason,
  type SubAgentCounts,
} from './types';

/**
 * Pure changes to one ticket. Each returns the ticket unchanged (the same object) when nothing
 * changes, so the store can skip the update and no component re-renders.
 */

export const NO_SUB_AGENTS: SubAgentCounts = Object.freeze({ queued: 0, running: 0, done: 0, failed: 0 });

/** The card's progress as 0 to 1; NaN and infinities count as 0, as in ProgressBar (D33). */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

type RecordFields = Pick<
  AgentTicket,
  'id' | 'title' | 'ado' | 'repo' | 'branch' | 'baseBranch' | 'createdAt' | 'stage' | 'stageEnteredAt' | 'gates' | 'model' | 'effort'
>;

function sameRecordFields(ticket: AgentTicket, fields: RecordFields): boolean {
  const sameAdo =
    ticket.ado === fields.ado ||
    (ticket.ado !== null &&
      fields.ado !== null &&
      ticket.ado.orgUrl === fields.ado.orgUrl &&
      ticket.ado.project === fields.ado.project &&
      ticket.ado.workItemId === fields.ado.workItemId);
  const sameGates =
    ticket.gates === fields.gates || STAGES.every((stage) => ticket.gates[stage] === fields.gates[stage]);
  return (
    sameAdo &&
    sameGates &&
    ticket.id === fields.id &&
    ticket.title === fields.title &&
    ticket.repo === fields.repo &&
    ticket.branch === fields.branch &&
    ticket.baseBranch === fields.baseBranch &&
    ticket.createdAt === fields.createdAt &&
    ticket.stage === fields.stage &&
    ticket.stageEnteredAt === fields.stageEnteredAt &&
    ticket.model === fields.model &&
    ticket.effort === fields.effort
  );
}

function sameLastBuild(a: TicketLastBuild | null, b: TicketLastBuild | null): boolean {
  if (a === b) return true;
  return (
    a !== null &&
    b !== null &&
    a.outcome === b.outcome &&
    a.startedAt === b.startedAt &&
    a.finishedAt === b.finishedAt &&
    a.errors === b.errors &&
    a.warnings === b.warnings
  );
}

function lastRunFromRecord(record: TicketRecord): AgentTicketRun {
  const last = record.lastRun;
  if (!last) return { state: 'stopped', url: null, startedAt: null };
  return { state: last.stoppedAt === null ? 'running' : 'stopped', url: last.url, startedAt: last.startedAt };
}

/**
 * A ticket from its record (start-up, AL-090; launch, AL-165). With `previous`, the live state the
 * record does not hold (activity, progress, gate, needs-you, sub-agents, build job, pull request,
 * pending switch) is kept, so reloading the records never blanks a running card.
 */
export function ticketFromRecord(record: TicketRecord, previous?: AgentTicket): AgentTicket {
  const stageEnteredAt = record.stageHistory.at(-1)?.at ?? record.createdAt;
  const recordFields = {
    id: record.id,
    title: record.title,
    ado: record.ado,
    repo: record.repo,
    branch: record.branch,
    baseBranch: record.baseBranch,
    createdAt: record.createdAt,
    stage: record.stage,
    stageEnteredAt,
    gates: record.gates,
    model: record.model,
    effort: record.effort,
  } satisfies Partial<AgentTicket>;

  if (previous) {
    if (sameRecordFields(previous, recordFields) && sameLastBuild(previous.build.last, record.lastBuild)) return previous;
    const switching =
      previous.switching && previous.switching.model === record.model && previous.switching.effort === record.effort
        ? null
        : previous.switching;
    const merged: AgentTicket = {
      ...previous,
      ...recordFields,
      switching,
      build: sameLastBuild(previous.build.last, record.lastBuild) ? previous.build : { ...previous.build, last: record.lastBuild },
    };
    // A stage change resolves a waiting gate, as `withStage` does.
    return previous.stage === record.stage ? merged : withGateResolved(merged);
  }

  return {
    ...recordFields,
    activity: null,
    progress: null,
    lastOutputAt: null,
    switching: null,
    gate: null,
    needsYou: [],
    subAgents: NO_SUB_AGENTS,
    build: { job: null, last: record.lastBuild },
    run: lastRunFromRecord(record),
    // The PR the Create PR stage opened (AL-181); its checks come with the next 'pr:status'.
    pullRequest: record.pullRequest ? { id: record.pullRequest.id, status: record.pullRequest.status, checks: null } : null,
  };
}

/**
 * Moves the ticket to another lane. A waiting gate is resolved by the move (the agent only moves
 * on once its gate was approved, AL-104), so its `approval` reason goes too.
 */
export function withStage(ticket: AgentTicket, stage: Lane, at: number): AgentTicket {
  if (ticket.stage === stage) return ticket;
  return withGateResolved({ ...ticket, stage, stageEnteredAt: at });
}

/** New activity text and, when given, progress (`report_activity`, AL-103). `text: null` clears the row. */
export function withActivity(
  ticket: AgentTicket,
  activity: { text: string | null; progress?: number | null },
  at: number,
): AgentTicket {
  const progress =
    activity.progress === undefined ? ticket.progress : activity.progress === null ? null : clampProgress(activity.progress);
  const sameText = activity.text === null ? ticket.activity === null : ticket.activity?.text === activity.text;
  if (sameText && progress === ticket.progress) return ticket;
  return {
    ...ticket,
    activity: sameText ? ticket.activity : activity.text === null ? null : { text: activity.text, at },
    progress,
  };
}

/** Stamps the newest output time; output older than the last one seen changes nothing. */
export function withOutputAt(ticket: AgentTicket, at: number): AgentTicket {
  if (ticket.lastOutputAt !== null && at <= ticket.lastOutputAt) return ticket;
  return { ...ticket, lastOutputAt: at };
}

function sameReason(a: NeedsYouReason, b: NeedsYouReason): boolean {
  if (a.kind !== b.kind || a.since !== b.since) return false;
  switch (a.kind) {
    case 'approval':
      return b.kind === 'approval' && a.stage === b.stage;
    case 'permission':
      return b.kind === 'permission' && a.tool === b.tool;
    case 'qa-gap':
      return b.kind === 'qa-gap' && a.gaps === b.gaps;
  }
}

/** Adds a reason, replacing one of the same kind; the list stays oldest first. */
function putReason(reasons: readonly NeedsYouReason[], reason: NeedsYouReason): readonly NeedsYouReason[] {
  const existing = reasons.find((other) => other.kind === reason.kind);
  if (existing && sameReason(existing, reason)) return reasons;
  return [...reasons.filter((other) => other.kind !== reason.kind), reason].sort((a, b) => a.since - b.since);
}

function dropReason(reasons: readonly NeedsYouReason[], kind: NeedsYouReason['kind']): readonly NeedsYouReason[] {
  return reasons.some((reason) => reason.kind === kind) ? reasons.filter((reason) => reason.kind !== kind) : reasons;
}

/** A gate waits for the user (`agent:gate`, AL-104): the card turns amber with "Needs you · approve …". */
export function withGateOpened(ticket: AgentTicket, stage: Stage, at: number): AgentTicket {
  if (ticket.gate?.stage === stage) return ticket;
  return {
    ...ticket,
    gate: { stage, openedAt: at },
    needsYou: putReason(ticket.needsYou, { kind: 'approval', stage, since: at }),
  };
}

/** The gate was approved, sent back with changes, or switched off. */
export function withGateResolved(ticket: AgentTicket): AgentTicket {
  if (ticket.gate === null && !ticket.needsYou.some((reason) => reason.kind === 'approval')) return ticket;
  return { ...ticket, gate: null, needsYou: dropReason(ticket.needsYou, 'approval') };
}

/** Adds or replaces a permission or QA-gap reason. Gate approvals go through `withGateOpened`. */
export function withNeedsYou(ticket: AgentTicket, reason: OtherNeedsYouReason): AgentTicket {
  const needsYou = putReason(ticket.needsYou, reason);
  return needsYou === ticket.needsYou ? ticket : { ...ticket, needsYou };
}

export function withoutNeedsYou(ticket: AgentTicket, kind: OtherNeedsYouKind): AgentTicket {
  const needsYou = dropReason(ticket.needsYou, kind);
  return needsYou === ticket.needsYou ? ticket : { ...ticket, needsYou };
}

/**
 * The user picked another model or effort (AL-106, AL-172). It applies from the next turn, so the
 * card shows "Switching · applies next turn"; picking the current values again cancels the switch.
 */
export function withModelRequested(ticket: AgentTicket, change: { model?: Model; effort?: Effort }, at: number): AgentTicket {
  const model = change.model ?? ticket.switching?.model ?? ticket.model;
  const effort = change.effort ?? ticket.switching?.effort ?? ticket.effort;
  if (model === ticket.model && effort === ticket.effort) {
    return ticket.switching === null ? ticket : { ...ticket, switching: null };
  }
  if (ticket.switching?.model === model && ticket.switching.effort === effort) return ticket;
  return { ...ticket, switching: { model, effort, requestedAt: at } };
}

/**
 * The session now runs with `applied` (the next turn started, AL-106); without it, with the pending
 * switch. The switch clears once the session uses what was asked for.
 */
export function withModelApplied(ticket: AgentTicket, applied?: { model: Model; effort: Effort }): AgentTicket {
  const now = applied ?? ticket.switching;
  if (!now) return ticket;
  const switching =
    ticket.switching && (ticket.switching.model !== now.model || ticket.switching.effort !== now.effort) ? ticket.switching : null;
  if (now.model === ticket.model && now.effort === ticket.effort && switching === ticket.switching) return ticket;
  return { ...ticket, model: now.model, effort: now.effort, switching };
}

/** Sub-agent counts from AL-107; negative or fractional counts are floored at 0. */
export function withSubAgents(ticket: AgentTicket, counts: SubAgentCounts): AgentTicket {
  const next = Object.fromEntries(
    SUB_AGENT_STATES.map((state) => [state, Number.isFinite(counts[state]) ? Math.max(0, Math.floor(counts[state])) : 0]),
  ) as Record<keyof SubAgentCounts, number>;
  if (SUB_AGENT_STATES.every((state) => next[state] === ticket.subAgents[state])) return ticket;
  return { ...ticket, subAgents: next };
}

export function subAgentTotal(counts: SubAgentCounts): number {
  return SUB_AGENT_STATES.reduce((total, state) => total + counts[state], 0);
}

function samePullRequest(a: AgentTicketPullRequest | null, b: AgentTicketPullRequest | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.id !== b.id || a.status !== b.status) return false;
  if (a.checks === b.checks) return true;
  return (
    a.checks !== null &&
    b.checks !== null &&
    a.checks.passed === b.checks.passed &&
    a.checks.total === b.checks.total &&
    a.checks.pending === b.checks.pending
  );
}

export function withPullRequest(ticket: AgentTicket, pullRequest: AgentTicketPullRequest | null): AgentTicket {
  return samePullRequest(ticket.pullRequest, pullRequest) ? ticket : { ...ticket, pullRequest };
}

/** A build queue update (`build:queued`, AL-131). Finished or cancelled clears the job; a stale job's update is ignored. */
export function withBuildJob(ticket: AgentTicket, job: Pick<BuildJob, 'jobId' | 'kind' | 'state' | 'position'>): AgentTicket {
  const current = ticket.build.job;
  if (job.state === 'queued' || job.state === 'running') {
    const next: AgentTicketBuildJob = { jobId: job.jobId, kind: job.kind, state: job.state, position: job.state === 'running' ? null : job.position };
    if (
      current &&
      current.jobId === next.jobId &&
      current.kind === next.kind &&
      current.state === next.state &&
      current.position === next.position
    ) {
      return ticket;
    }
    return { ...ticket, build: { ...ticket.build, job: next } };
  }
  // Finished or cancelled: only the job the ticket shows clears it.
  if (current?.jobId !== job.jobId) return ticket;
  return { ...ticket, build: { ...ticket.build, job: null } };
}

/** The last finished build (AL-132). */
export function withLastBuild(ticket: AgentTicket, last: TicketLastBuild): AgentTicket {
  if (sameLastBuild(ticket.build.last, last)) return ticket;
  return { ...ticket, build: { ...ticket.build, last } };
}

export function withRun(ticket: AgentTicket, run: AgentTicketRun): AgentTicket {
  const current = ticket.run;
  if (current.state === run.state && current.url === run.url && current.startedAt === run.startedAt) return ticket;
  return { ...ticket, run };
}
