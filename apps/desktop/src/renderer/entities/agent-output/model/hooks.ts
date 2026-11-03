import { useEffect } from 'react';
import type { AgentOutputEvent } from '@agent-lanes/contracts';
import { useStore } from 'zustand';
import { openTicketOutput } from './backfill';
import { agentOutput, selectTicketOutput, selectTicketSkeleton, type AgentOutputStore } from './store';

const NONE: readonly AgentOutputEvent[] = [];

/**
 * A ticket's output, oldest first: what main buffered before the view opened, then live output
 * (AL-102). The drill-in's Output tab (AL-175) renders it.
 */
export function useAgentOutput(ticketId: string, store: AgentOutputStore = agentOutput): readonly AgentOutputEvent[] {
  useEffect(() => {
    void openTicketOutput(ticketId, store);
  }, [ticketId, store]);
  return useStore(store, (state) => selectTicketOutput(state, ticketId));
}

/**
 * A ticket's output without each stream's later deltas (`TicketOutput.skeleton`): the same list, with the same
 * identity, until a structural event arrives. Turns, agents and rows derive from it. `null` watches nothing.
 */
export function useAgentOutputSkeleton(ticketId: string | null, store: AgentOutputStore = agentOutput): readonly AgentOutputEvent[] {
  useEffect(() => {
    if (ticketId !== null) void openTicketOutput(ticketId, store);
  }, [ticketId, store]);
  return useStore(store, (state) => (ticketId === null ? NONE : selectTicketSkeleton(state, ticketId)));
}
