import { UNKNOWN_AGENT_COLOR } from '@/shared/config';
import { agentById, type AgentView } from '@/entities/agent';
import { toolCountsLabel, turnsCost, type Turn } from '@/entities/turn';
import { countOf, formatCost, formatTurnDuration, readableOn } from '../lib/format';

/** The narrowest a turn's button gets, whatever its length (handoff: `min-width: 26px`). */
export const TURN_MIN_WIDTH = 26;
export const TURN_HEIGHT = 30;
/** The live turn's fill: violet into sky, as the progress bars. */
export const LIVE_TURN_FILL = 'linear-gradient(90deg, #5B4BC4, #38BDF8)';

export interface TurnSegment {
  readonly index: number;
  /** `flex-grow`: the turn's length in minutes (never quite nothing, so a turn with no length still has its minimum). */
  readonly grow: number;
  /** The colour of the agent that led the turn; null for the live turn, which is the violet gradient. */
  readonly fill: string | null;
  /** The text colour that reads on the fill. */
  readonly ink: string;
  /** "T3". */
  readonly label: string;
  /** "$0.42"; a live turn has no cost yet, so it says "live". */
  readonly cost: string;
  readonly live: boolean;
  readonly agentName: string;
  /** "Turn 3, 4m 12s, $0.42, led by Lead". */
  readonly name: string;
}

/** One button per turn for the turn strip, with its width, colour and caption. */
export function turnSegments(turns: readonly Turn[], agents: readonly AgentView[]): TurnSegment[] {
  return turns.map((turn): TurnSegment => {
    const live = turn.endedAt === null;
    const agent = agentById(agents, turn.leadAgentId);
    const fill = live ? null : (agent?.color ?? UNKNOWN_AGENT_COLOR);
    const agentName = agent?.name ?? 'an earlier agent';
    const cost = live ? 'live' : formatCost(turn.costUsd);
    return {
      index: turn.index,
      grow: Math.max(turn.durationMs / 60_000, 0.1),
      fill,
      ink: fill === null ? '#FFFFFF' : readableOn(fill),
      label: `T${turn.index}`,
      cost,
      live,
      agentName,
      name: `Turn ${turn.index}, ${live ? 'running' : formatTurnDuration(turn.durationMs)}, ${live ? 'live' : cost}, led by ${agentName}`,
    };
  });
}

/** "7 turns · $2.06", at the right of the strip. */
export function turnTotalLabel(turns: readonly Turn[]): string {
  return `${countOf(turns.length, 'turn')} · ${formatCost(turnsCost(turns))}`;
}

/** What the turn's colour means, for a tooltip: its lead agent and the tools it used. */
export function turnTooltip(turn: Turn, agents: readonly AgentView[]): string {
  const agent = agentById(agents, turn.leadAgentId);
  const tools = toolCountsLabel(turn.toolCounts);
  return `Turn ${turn.index} · led by ${agent?.name ?? 'an earlier agent'}${tools ? ` · ${tools}` : ''}`;
}
