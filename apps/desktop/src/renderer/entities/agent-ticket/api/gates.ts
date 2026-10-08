import { useMutation } from '@tanstack/react-query';
import type { Gate, Stage } from '@agent-lanes/contracts';
import { invoke, unwrap } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from '../model/store';

export type GateDecision = { decision: 'approve' } | { decision: 'request-changes'; note: string };

/**
 * Approve or Request changes on the ticket's waiting gate (`agent:resolveGate`, AL-104). The board's
 * card and the drill-in's stepper both call this one action (AL-171), so a decision taken in either
 * place clears the gate in the store both read. `agent:gate` clears it too; `resolved: false` means
 * someone already decided it, so the stale gate goes either way.
 */
export function useResolveGate(store: AgentTicketStore = agentTickets) {
  return useMutation({
    mutationFn: async ({ ticketId, ...decision }: { ticketId: string } & GateDecision) =>
      unwrap(
        await invoke('agent:resolveGate', {
          ticketId,
          decision: decision.decision,
          ...(decision.decision === 'request-changes' ? { note: decision.note } : {}),
        }),
      ),
    onSuccess: (_result, { ticketId }) => store.resolveGate(ticketId),
  });
}

/**
 * Switches one stage of a ticket between Auto and Needs approval (`agent:setGate`, AL-171). Switching
 * off the gate that waits lets the move through as approved (`released`).
 */
export function useSetGate(store: AgentTicketStore = agentTickets) {
  return useMutation({
    mutationFn: async (request: { ticketId: string; stage: Stage; gate: Gate }) => unwrap(await invoke('agent:setGate', request)),
    onSuccess: ({ gates, released }, { ticketId }) => {
      store.setGates(ticketId, gates);
      if (released) store.resolveGate(ticketId);
    },
  });
}
