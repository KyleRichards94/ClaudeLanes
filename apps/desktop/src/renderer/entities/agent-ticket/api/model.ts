import { useMutation } from '@tanstack/react-query';
import type { AgentModelState, Effort, Model } from '@agent-lanes/contracts';
import { invoke, unwrap } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from '../model/store';

/**
 * Live model and effort change (AL-106, R7; the Agent panel AL-172 and "Apply model now" AL-176).
 * The card shows the switch at once ("Opus → Sonnet · High", "Switching · applies next turn"); main
 * confirms it and clears it with `agent:model` when the session uses it.
 */
function applyState(store: AgentTicketStore, state: AgentModelState): void {
  store.applyModelChange(state.ticketId, { model: state.model, effort: state.effort });
  store.requestModelChange(state.ticketId, state.pending ?? { model: state.model, effort: state.effort }, Date.now());
}

export function useSetAgentModel(store: AgentTicketStore = agentTickets) {
  return useMutation({
    mutationFn: async (request: { ticketId: string; model: Model }) => unwrap(await invoke('agent:setModel', request)),
    onMutate: (request) => store.requestModelChange(request.ticketId, { model: request.model }, Date.now()),
    onSuccess: (state) => applyState(store, state),
  });
}

export function useSetAgentEffort(store: AgentTicketStore = agentTickets) {
  return useMutation({
    mutationFn: async (request: { ticketId: string; effort: Effort }) => unwrap(await invoke('agent:setEffort', request)),
    onMutate: (request) => store.requestModelChange(request.ticketId, { effort: request.effort }, Date.now()),
    onSuccess: (state) => applyState(store, state),
  });
}

/** "Apply model now": interrupts the turn and continues on the new model and effort. */
export function useApplyModelNow(store: AgentTicketStore = agentTickets) {
  return useMutation({
    mutationFn: async (request: { ticketId: string }) => unwrap(await invoke('agent:applyModelNow', request)),
    onSuccess: (state) => applyState(store, state),
  });
}
