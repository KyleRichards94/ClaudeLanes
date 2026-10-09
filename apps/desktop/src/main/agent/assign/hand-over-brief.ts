import type { AgentOutputEvent, GitDiff, PendingGate, TicketRecord } from '@agent-lanes/contracts';
import { LANE_LABELS } from '../stages/stage-rules';

/**
 * The hand-over brief (AL-263): the first turn of a new agent that takes a ticket over. Built in
 * main from what the app already knows, so the new session starts with the ticket, the original job,
 * the stage history, the open gate, the diff against the base branch and the previous agent's last
 * messages, and never has to rediscover them.
 */
export interface HandOverBriefInput {
  record: TicketRecord;
  /** The ticket's output so far, oldest first. */
  events: readonly AgentOutputEvent[];
  /** The changes against the base branch; null when they could not be read. */
  diff: GitDiff | null;
  /** The gate that waited on the previous session, if any. */
  pendingGate: PendingGate | null;
  /** How many of the previous agent's last messages to pass on. */
  lastMessages?: number;
}

export const HAND_OVER_HEADING = 'Hand-over brief';
/** The whole brief is clipped here; a session's first turn should not swallow the context window. */
export const HAND_OVER_BRIEF_LIMIT = 20_000;
const JOB_LIMIT = 4_000;
const MESSAGE_LIMIT = 1_500;
const SYSTEM_LINES = 12;
const DIFF_FILES = 25;
const DEFAULT_LAST_MESSAGES = 5;

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function buildHandOverBrief(input: HandOverBriefInput): string {
  const { record, events } = input;
  const sections: string[] = [];
  sections.push(
    `${HAND_OVER_HEADING}: you are taking over Agent Lanes ticket ${record.id} (${record.title}) from a previous agent. Its worktree, branch and commits are yours now; nothing was reset.`,
  );
  sections.push(record.ado ? `Work item: Azure DevOps #${record.ado.workItemId} in ${record.ado.project}.` : 'The ticket has no Azure DevOps work item.');
  if (record.job?.trim()) sections.push(`The original job:\n${clip(record.job.trim(), JOB_LIMIT)}`);

  const history = record.stageHistory.map((entry) => LANE_LABELS[entry.stage]).join(' → ');
  sections.push(`Stage now: ${LANE_LABELS[record.stage]} (so far: ${history}).`);
  const gate = input.pendingGate;
  if (gate) {
    sections.push(
      `A gate was open: ${LANE_LABELS[gate.stage]} waited for the user's approval to move to ${LANE_LABELS[gate.to]}${gate.summary ? ` — ${gate.summary}` : ''}. It closed with the previous session; ask again with set_stage when you are ready.`,
    );
  }

  const lines = events.flatMap((event) => (event.item.kind === 'system' && event.item.parentToolUseId === null ? [event.item.text] : [])).slice(-SYSTEM_LINES);
  if (lines.length > 0) sections.push(`What happened, from the ticket's output:\n${lines.map((line) => `- ${line}`).join('\n')}`);

  const diff = input.diff;
  if (diff) {
    const added = diff.files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
    const removed = diff.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
    const shown = diff.files.slice(0, DIFF_FILES).map((file) => `- ${file.status} ${file.path}${file.additions !== null ? ` (+${file.additions} −${file.deletions ?? 0})` : ''}`);
    const more = diff.files.length > DIFF_FILES ? [`- … and ${diff.files.length - DIFF_FILES} more`] : [];
    const count = `${diff.files.length}${diff.truncated ? '+' : ''} ${diff.files.length === 1 ? 'file' : 'files'}`;
    sections.push(
      `Changes against ${diff.fromRef}: ${count}, +${added} −${removed}${diff.includesUncommitted ? ' (uncommitted changes included)' : ''}.${shown.length > 0 ? `\n${[...shown, ...more].join('\n')}` : ''}`,
    );
  }

  const messages = events
    .flatMap((event) => (event.item.kind === 'text' && event.item.parentToolUseId === null ? [clip(event.item.text.trim(), MESSAGE_LIMIT)] : []))
    .filter(Boolean)
    .slice(-(input.lastMessages ?? DEFAULT_LAST_MESSAGES));
  if (messages.length > 0) {
    const label = messages.length === 1 ? 'last message' : `last ${messages.length} messages, oldest first`;
    sections.push(`The previous agent's ${label}:\n${messages.map((message) => `---\n${message}`).join('\n')}\n---`);
  }

  sections.push('Pick up from here: read the worktree before changing anything, do not redo finished work, and report your stage with set_stage as before.');
  return clip(sections.join('\n\n'), HAND_OVER_BRIEF_LIMIT);
}
