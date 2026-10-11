import type { Lane } from '@agent-lanes/contracts';
import type { AgentTicket } from '@/entities/agent-ticket';
import { LANE_LABELS } from '@/shared/config';

/**
 * The board digest (AL-272): every agent ticket ranked by what it needs, worked out from the ticket
 * store alone. Pure, so it is instant and tested without rendering.
 */
export type DigestKind = 'needs-you' | 'dead' | 'build-failed' | 'finished' | 'quiet' | 'queued' | 'working' | 'done';

export interface DigestEntry {
  ticketId: string;
  /** "#71273" or the ticket id. */
  label: string;
  title: string;
  stage: Lane;
  kind: DigestKind;
  /** Why it ranks where it does, in order ("Waiting for you · approve plan", "Session lost"). */
  reasons: string[];
  /** The most useful next step the board can offer: open the drill-in, resume the session. */
  action: 'open' | 'resume';
}

/** Ranks: what needs the user first, then what stopped, then what is idle with work to pick up. */
const RANK: Readonly<Record<DigestKind, number>> = { 'needs-you': 0, dead: 1, 'build-failed': 2, finished: 3, quiet: 4, queued: 5, working: 6, done: 7 };

/** A running agent silent for this long is worth a look. */
export const QUIET_AFTER_MS = 2 * 60 * 60 * 1000;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function hours(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function digestEntry(ticket: AgentTicket, now: number): DigestEntry {
  const reasons: string[] = [];
  let kind: DigestKind = 'working';
  let action: DigestEntry['action'] = 'open';

  if (ticket.stage === 'done') {
    kind = 'done';
    reasons.push(ticket.activity?.text ?? 'Done');
  } else if (ticket.stage === 'queued') {
    kind = 'queued';
    reasons.push('Waiting for a free slot');
  }

  for (const reason of ticket.needsYou) {
    kind = 'needs-you';
    if (reason.kind === 'approval') reasons.push(`Waiting for you · approve ${LANE_LABELS[reason.stage].toLowerCase()}${ticket.gate?.summary ? ` · ${ticket.gate.summary}` : ''}`);
    else if (reason.kind === 'permission') reasons.push(`Waiting for you · allow ${reason.tool}`);
    else reasons.push(`QA found ${plural(reason.gaps, 'gap')}`);
  }

  if (kind !== 'needs-you' && kind !== 'done' && kind !== 'queued') {
    if (ticket.session === 'lost') {
      kind = 'dead';
      action = 'resume';
      reasons.push('Session lost');
    } else if (ticket.session === 'stopped' || ticket.session === 'none') {
      const finished = ticket.lastOutputAt !== null;
      kind = ticket.build.last?.outcome === 'failed' ? 'build-failed' : finished ? 'finished' : 'dead';
      action = kind === 'finished' ? 'open' : 'resume';
      reasons.push(ticket.session === 'none' ? 'No agent running' : finished ? 'Agent finished' : 'Session ended');
    } else if (ticket.build.last?.outcome === 'failed') {
      kind = 'build-failed';
    } else if (ticket.lastOutputAt !== null && now - ticket.lastOutputAt > QUIET_AFTER_MS) {
      kind = 'quiet';
      reasons.push(`Quiet for ${hours(now - ticket.lastOutputAt)}`);
    }
  }

  if (ticket.build.last?.outcome === 'failed') reasons.push(`Build failed · ${plural(ticket.build.last.errors, 'error')}`);
  if (ticket.pullRequest) {
    const checks = ticket.pullRequest.checks;
    reasons.push(`PR !${ticket.pullRequest.id} ${ticket.pullRequest.status}${checks ? ` · ${checks.passed}/${checks.total} checks` : ''}`);
  }
  if (ticket.prActivity && (ticket.prActivity.comments > 0 || ticket.prActivity.threads > 0)) {
    reasons.push(ticket.prActivity.threads > 0 ? `${plural(ticket.prActivity.threads, 'thread')} actioned` : `${plural(ticket.prActivity.comments, 'comment')} posted`);
  }
  if (kind === 'finished' && ticket.stage === 'create-pr' && !ticket.pullRequest) reasons.push('Ready to merge or open a PR');
  if (kind === 'working' && ticket.activity?.text) reasons.push(ticket.activity.text);

  return {
    ticketId: ticket.id,
    label: ticket.ado ? `#${ticket.ado.workItemId}` : ticket.id,
    title: ticket.title,
    stage: ticket.stage,
    kind,
    reasons,
    action,
  };
}

/** Every ticket, what needs you first; within a rank the oldest in its stage first. */
export function boardDigest(tickets: readonly AgentTicket[], now: number): DigestEntry[] {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  return tickets
    .map((ticket) => digestEntry(ticket, now))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || (byId.get(a.ticketId)?.stageEnteredAt ?? 0) - (byId.get(b.ticketId)?.stageEnteredAt ?? 0));
}

export const DIGEST_HEADINGS: Readonly<Record<DigestKind, string>> = {
  'needs-you': 'Waiting for you',
  dead: 'Agent stopped',
  'build-failed': 'Build failed',
  finished: 'Finished · pick up',
  quiet: 'Quiet',
  queued: 'Queued',
  working: 'Working',
  done: 'Done',
};

/** The digest as text for the model (AL-272): one line per ticket, needs-you first. */
export function digestText(entries: readonly DigestEntry[]): string {
  if (entries.length === 0) return 'The agent board is empty.';
  return entries.map((entry) => `- ${entry.label} "${entry.title}" · ${LANE_LABELS[entry.stage]} · ${DIGEST_HEADINGS[entry.kind]}${entry.reasons.length ? ` · ${entry.reasons.join(' · ')}` : ''}`).join('\n');
}
