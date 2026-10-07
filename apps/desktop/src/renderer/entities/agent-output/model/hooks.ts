import { useEffect } from 'react';
import type { AgentOutputEvent } from '@agent-lanes/contracts';
import { useStore } from 'zustand';
import { openTicketOutput } from './backfill';
import { agentOutput, selectTicketOutput, type AgentOutputStore } from './store';

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
