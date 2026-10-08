import type { Effort, Model } from '@agent-lanes/contracts';
import { EFFORT_LABELS, MODEL_LABELS, type AgentTicket } from '@/entities/agent-ticket';

export type ModelControlsTicket = Pick<AgentTicket, 'id' | 'model' | 'effort' | 'switching' | 'stage'>;

/**
 * What the Agent panel's model and effort switchers show (AL-172, artboard 3, R7). The segments show
 * what the user asked for, so a pick sticks at once; while the session still runs the old model or
 * effort the panel says so ("Opus → Sonnet · High", "Switching · next turn") until `agent:model`
 * reports the change in use (AL-106).
 */
export interface ModelControls {
  /** The model and effort the segments show: the pending switch, else what runs. */
  model: Model;
  effort: Effort;
  /** "Opus → Sonnet · High" or "Opus · XHigh → High" while a change waits for the next turn. */
  switchingLine: string | null;
  /** Why the switchers are off, or null when they work. */
  disabledReason: string | null;
}

export function modelControls(ticket: ModelControlsTicket): ModelControls {
  const switching = ticket.switching;
  return {
    model: switching?.model ?? ticket.model,
    effort: switching?.effort ?? ticket.effort,
    switchingLine: switching ? switchingLine(ticket, switching) : null,
    disabledReason: ticket.stage === 'done' ? 'The ticket is done; there is no agent to switch.' : null,
  };
}

function switchingLine(ticket: ModelControlsTicket, to: { model: Model; effort: Effort }): string {
  const from = MODEL_LABELS[ticket.model];
  if (to.model !== ticket.model) return `${from} → ${MODEL_LABELS[to.model]} · ${EFFORT_LABELS[to.effort]}`;
  return `${from} · ${EFFORT_LABELS[ticket.effort]} → ${EFFORT_LABELS[to.effort]}`;
}
