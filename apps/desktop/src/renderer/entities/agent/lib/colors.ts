import { LEAD_AGENT_COLOR, SUB_AGENT_COLORS, UNKNOWN_AGENT_COLOR } from '@/shared/config';

export { LEAD_AGENT_COLOR, SUB_AGENT_COLORS, UNKNOWN_AGENT_COLOR };

/**
 * An agent's colour (AL-278, handoff "Flight deck > Agent colours"). The lead is always violet. The others
 * take `SUB_AGENT_COLORS` in spawn order, `spawnIndex` counting from 0 among sub-agents and second agents
 * together, and the six repeat after the sixth. No `spawnIndex` for a sub-agent is the neutral grey of an
 * unknown author.
 */
export function agentColor(role: 'lead' | 'sub', spawnIndex?: number): string {
  if (role === 'lead') return LEAD_AGENT_COLOR;
  if (spawnIndex === undefined || !Number.isInteger(spawnIndex) || spawnIndex < 0) return UNKNOWN_AGENT_COLOR;
  return SUB_AGENT_COLORS[spawnIndex % SUB_AGENT_COLORS.length] ?? UNKNOWN_AGENT_COLOR;
}

/**
 * Colours for agents in the order they were spawned (`startedAt`, then id): the same list always gives the
 * same colours, so both layouts, and a restart that replays the stream, agree. A newly spawned agent never
 * changes another's colour.
 */
export function assignAgentColors(spawned: readonly { id: string; startedAt: number }[]): Map<string, string> {
  const colors = new Map<string, string>();
  const ordered = [...spawned].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  ordered.forEach((agent, index) => colors.set(agent.id, agentColor('sub', index)));
  return colors;
}
