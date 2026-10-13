import { useMemo } from 'react';
import type { AgentOutputEvent, TicketStageEntry } from '@agent-lanes/contracts';
import { deriveTurns, type Turn } from '../lib/derive-turns';

/**
 * A ticket's turns from its output events and stage history, recomputed only when either changes.
 * Entities cannot import each other, so the caller supplies the events (`useAgentOutput`); the feature
 * `ticket-insight` exports `useTurns(ticketId, history)` that does it for you.
 */
export function useTurnList(events: readonly AgentOutputEvent[], stageHistory: readonly TicketStageEntry[]): Turn[] {
  return useMemo(() => deriveTurns(events, stageHistory), [events, stageHistory]);
}
