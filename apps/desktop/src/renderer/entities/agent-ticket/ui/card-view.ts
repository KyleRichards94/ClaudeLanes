import { formatPullRequestActivity, type Stage } from '@agent-lanes/contracts';
import { EFFORT_LABELS, LANE_LABELS, MODEL_LABELS } from '@/shared/config';
import { subAgentTotal } from '../model/ticket';
import type { AgentTicket, NeedsYouReason } from '../model/types';

/**
 * What an agent ticket card shows, worked out from the ticket alone (artboard 6, R6). Pure, so every
 * state on the artboard is tested without rendering, and the card only lays the result out.
 */
export type CardState =
  | 'queued'
  | 'running'
  | 'needs-you'
  | 'switching'
  | 'build-failed'
  | 'pr-open'
  | 'merged';

/** The tint of the activity area, its dot and its progress bar. `neutral` is the queued card's grey. */
export type CardActivityTone = 'claude' | 'ado' | 'danger' | 'ok' | 'neutral';

export interface CardView {
  state: CardState;
  /** Card outline: amber when it needs the user, red for a failed build, faded once merged. */
  border: 'default' | 'attention' | 'danger' | 'muted';
  activity: { text: string; tone: CardActivityTone };
  /** 0 to 1. */
  progress: number;
  /** "Opus · XHigh", or "Opus → Sonnet · High" while a switch waits for the next turn. */
  modelLine: string;
  /** "3 sub-agents", or "—" when there are none. */
  subAgentsLine: string;
  /** The status band along the bottom; null when the card has none. */
  footer: { tone: 'attention' | 'ado' | 'danger'; label: string } | null;
  /** "Design v2" once a spec was shipped; amber "Design v3 not yet used" until the agent acknowledges it (AL-200). */
  design: { label: string; tone: 'claude' | 'attention' } | null;
  /**
   * The top-right corner of a card without a work item state (a PR review or a "No ticket" ticket):
   * "Done" once its agent finished (Kyle, 2026-10-09), or with a tick "Reviewed · 4 comments" /
   * "Actioned · 3 threads" once it posted to its pull request (AL-269); null otherwise.
   */
  corner: { label: string; tone: 'ok'; tick: boolean } | null;
}

/** The finished corner (AL-269): what the agent did on the PR, or plain "Done". */
export function finishedCorner(ticket: Pick<AgentTicket, 'ado' | 'session' | 'lastOutputAt' | 'stage' | 'needsYou' | 'prActivity'>): CardView['corner'] {
  if (ticket.ado !== null || !agentFinished(ticket)) return null;
  const activity = ticket.prActivity;
  if (activity && activity.threads > 0) return { label: `Actioned · ${plural(activity.threads, 'thread')}`, tone: 'ok', tick: true };
  if (activity && activity.comments > 0) return { label: `Reviewed · ${plural(activity.comments, 'comment')}`, tone: 'ok', tick: true };
  return { label: 'Done', tone: 'ok', tick: false };
}

/** What a screen reader says for the card: "#71273, Cutover frmJobControl to Blazor, Implementing, …". */
export function agentCardName(ticket: AgentTicket): string {
  const view = cardView(ticket);
  return [ticket.ado ? `#${ticket.ado.workItemId}` : ticket.id, ticket.title, LANE_LABELS[ticket.stage], view.activity.text, view.design?.label, view.footer?.label]
    .filter(Boolean)
    .join(', ');
}

/** A review or no-ticket agent has finished: its session is idle or ended after producing output. */
export function agentFinished(ticket: Pick<AgentTicket, 'session' | 'lastOutputAt' | 'stage' | 'needsYou'>): boolean {
  if (ticket.stage === 'queued' || ticket.needsYou.length > 0) return false;
  return (ticket.session === 'idle' || ticket.session === 'stopped') && ticket.lastOutputAt !== null;
}

/** What a gate on each stage asks the user to approve ("Needs you · approve plan"). */
export const GATE_ASKS: Readonly<Record<Stage, string>> = {
  planning: 'approve plan',
  implementing: 'approve changes',
  'code-review': 'approve fixes',
  qa: 'approve QA',
  'create-pr': 'approve PR',
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Needs you · approve plan", "Needs you · 1 gap", "Needs you · allow Bash". */
export function needsYouLabel(reason: NeedsYouReason): string {
  switch (reason.kind) {
    case 'approval':
      return `Needs you · ${GATE_ASKS[reason.stage]}`;
    case 'qa-gap':
      return `Needs you · ${plural(reason.gaps, 'gap')}`;
    case 'permission':
      return `Needs you · allow ${reason.tool}`;
  }
}

/** The activity row while the agent waits and has reported nothing else ("Plan ready for review"). */
function waitingText(reason: NeedsYouReason): string {
  switch (reason.kind) {
    case 'approval':
      return reason.stage === 'planning' ? 'Plan ready for review' : 'Waiting for your approval';
    case 'qa-gap':
      return 'QA found unmet criteria';
    case 'permission':
      return `Asking to use ${reason.tool}`;
  }
}

/** Local wall-clock time, "15:20". */
export function clockTime(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function modelLine(ticket: AgentTicket): string {
  const now = MODEL_LABELS[ticket.model];
  const switching = ticket.switching;
  if (!switching) return `${now} · ${EFFORT_LABELS[ticket.effort]}`;
  // A model change reads "Opus → Sonnet · High" (artboard 6: the effort that applies with it);
  // an effort change alone reads "Opus · XHigh → High".
  if (switching.model !== ticket.model) return `${now} → ${MODEL_LABELS[switching.model]} · ${EFFORT_LABELS[switching.effort]}`;
  return `${now} · ${EFFORT_LABELS[ticket.effort]} → ${EFFORT_LABELS[switching.effort]}`;
}

/** The card's design indicator (AL-200): null before any spec was shipped. */
export function designIndicator(design: AgentTicket['design']): CardView['design'] {
  if (!design) return null;
  return design.used ? { label: `Design v${design.version}`, tone: 'claude' } : { label: `Design v${design.version} not yet used`, tone: 'attention' };
}

export function cardView(ticket: AgentTicket): CardView {
  const total = subAgentTotal(ticket.subAgents);
  const base = {
    modelLine: modelLine(ticket),
    subAgentsLine: total > 0 ? plural(total, 'sub-agent') : '—',
    design: designIndicator(ticket.design),
    corner: finishedCorner(ticket),
  };
  const progress = ticket.progress ?? 0;
  const reason = ticket.needsYou[0];
  const lastBuild = ticket.build.last;
  const buildFailed = lastBuild?.outcome === 'failed' && ticket.build.job === null;
  const pr = ticket.pullRequest;

  if (ticket.stage === 'done' || pr?.status === 'completed') {
    return {
      ...base,
      state: 'merged',
      border: 'muted',
      // An abandoned PR also ends in Done (AL-181), but nothing was merged.
      activity:
        pr?.status === 'abandoned'
          ? { text: formatPullRequestActivity({ id: pr.id, status: pr.status }), tone: 'neutral' }
          : { text: `Merged into ${ticket.baseBranch} · ${clockTime(ticket.stageEnteredAt)}`, tone: 'ok' },
      progress: 1,
      subAgentsLine: '—',
      footer: null,
    };
  }

  if (ticket.stage === 'queued') {
    return {
      ...base,
      state: 'queued',
      border: 'default',
      activity: { text: 'Waiting for a free slot', tone: 'neutral' },
      progress: 0,
      footer: null,
    };
  }

  const activityText = ticket.activity?.text;

  if (reason) {
    return {
      ...base,
      state: 'needs-you',
      border: 'attention',
      activity: { text: activityText ?? waitingText(reason), tone: 'claude' },
      progress,
      footer: { tone: 'attention', label: needsYouLabel(reason) },
    };
  }

  if (buildFailed) {
    return {
      ...base,
      state: 'build-failed',
      border: 'danger',
      activity: { text: activityText ?? 'Build failed', tone: 'danger' },
      progress,
      footer: { tone: 'danger', label: `Build failed · ${plural(lastBuild.errors, 'error')}` },
    };
  }

  if (ticket.switching) {
    return {
      ...base,
      state: 'switching',
      border: 'default',
      activity: { text: activityText ?? 'Finishing current turn', tone: 'claude' },
      progress,
      footer: { tone: 'ado', label: 'Switching · applies next turn' },
    };
  }

  if (pr && pr.status === 'active') {
    const checks = pr.checks;
    return {
      ...base,
      state: 'pr-open',
      border: 'default',
      activity: { text: formatPullRequestActivity({ id: pr.id, status: pr.status }, checks), tone: 'ado' },
      progress: checks && checks.total > 0 ? checks.passed / checks.total : progress,
      footer: null,
    };
  }

  return {
    ...base,
    state: 'running',
    border: 'default',
    activity: { text: activityText ?? `Starting ${LANE_LABELS[ticket.stage]}`, tone: 'claude' },
    progress,
    footer: null,
  };
}
