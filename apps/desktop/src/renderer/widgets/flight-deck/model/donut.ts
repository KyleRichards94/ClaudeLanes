import type { AgentView } from '@/entities/agent';
import { LEAD_AGENT_COLOR } from '@/shared/config';

/** What an agent counts as on the donut: the lead on its own, the others by their status. */
export type DonutState = 'lead' | 'running' | 'done' | 'idle' | 'error';

/** Segment colours by state (handoff "Right rail > Agents card"): running indigo, done green, the lead violet. */
export const DONUT_COLORS: Readonly<Record<DonutState, string>> = {
  lead: LEAD_AGENT_COLOR,
  running: '#818CF8',
  done: '#34D399',
  idle: '#CBD5E1',
  error: '#F87171',
};

/** The words the legend uses for each state. */
export const DONUT_WORDS: Readonly<Record<DonutState, string>> = {
  lead: 'lead',
  running: 'running',
  done: 'done',
  idle: 'idle',
  error: 'failed',
};

export const DONUT_ORDER: readonly DonutState[] = ['lead', 'running', 'done', 'idle', 'error'];

export const DONUT_SIZE = 84;
export const DONUT_STROKE = 5;
/** The gap between segments, in the circle's own units. */
const SEGMENT_GAP = 3;

export function donutState(agent: Pick<AgentView, 'role' | 'status'>): DonutState {
  return agent.role === 'lead' ? 'lead' : agent.status;
}

/** How many agents are in each state (the legend). */
export function stateCounts(agents: readonly Pick<AgentView, 'role' | 'status'>[]): Record<DonutState, number> {
  const counts: Record<DonutState, number> = { lead: 0, running: 0, done: 0, idle: 0, error: 0 };
  for (const agent of agents) counts[donutState(agent)] += 1;
  return counts;
}

export interface DonutSegment {
  readonly id: string;
  readonly state: DonutState;
  readonly color: string;
  /** A running agent's segment pulses (not under reduced motion). */
  readonly pulse: boolean;
  /** Stroke dash array (drawn length, then the rest of the circle) and the offset that puts the segment in its place. */
  readonly dashArray: string;
  readonly dashOffset: number;
}

/**
 * One segment per agent, equal in size, clockwise from the top, coloured by state. A lone agent is a full ring.
 * `radius` is the circle's radius in SVG units.
 */
export function donutSegments(agents: readonly Pick<AgentView, 'id' | 'role' | 'status'>[], radius = (DONUT_SIZE - DONUT_STROKE) / 2): DonutSegment[] {
  const circumference = 2 * Math.PI * radius;
  const share = circumference / Math.max(agents.length, 1);
  const length = agents.length > 1 ? Math.max(share - SEGMENT_GAP, 1) : share;
  return agents.map((agent, index) => {
    const state = donutState(agent);
    return {
      id: agent.id,
      state,
      color: DONUT_COLORS[state],
      pulse: agent.status === 'running',
      dashArray: `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`,
      dashOffset: Number((-index * share).toFixed(2)),
    };
  });
}

/** Each agent's share of the largest agent's tokens, 0 to 1; null when it has none to show. */
export function tokenShare(tokens: number | null, largest: number): number | null {
  if (tokens === null || tokens <= 0 || largest <= 0) return null;
  return Math.min(1, tokens / largest);
}
