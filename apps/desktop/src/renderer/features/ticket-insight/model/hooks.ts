import { useEffect, useMemo } from 'react';
import type { AgentOutputEvent, TicketRecord, TicketStageEntry } from '@agent-lanes/contracts';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { deriveAgents, type AgentView, type CompanionAgentInput } from '@/entities/agent';
import { agentOutput, openTicketOutput, selectTicketOutput, useAgentOutput } from '@/entities/agent-output';
import { agentTickets, useAgentTicket } from '@/entities/agent-ticket';
import { useSubAgents } from '@/entities/sub-agent';
import { useTurnList, type Turn } from '@/entities/turn';

/**
 * A ticket's turns (AL-278): derived from its output stream and stage history, so they replay after a
 * restart. The ticket's output is opened (backfilled and followed) if nothing opened it yet.
 */
export function useTurns(ticketId: string, history: readonly TicketStageEntry[]): Turn[] {
  const events = useAgentOutput(ticketId);
  return useTurnList(events, history);
}

/**
 * Every agent of a ticket for both layouts (AL-278): the lead (the ticket), its sub-agents (the `agent:getSubagents`
 * tree, kept current by `agent:subagent` events) and the second agents in `companions` (their ticket records, from
 * `companionsOf`). Colours are assigned once in spawn order; `activeFile` and `activeKind` come from the output streams
 * of the lead and of each second agent. Empty until the lead's ticket is in the store.
 */
export function useAgents(ticketId: string, companions: readonly TicketRecord[] = []): AgentView[] {
  const lead = useAgentTicket(ticketId);
  const tree = useSubAgents(ticketId).data;
  const leadEvents = useAgentOutput(ticketId);

  const companionIds = useMemo(() => companions.map((companion) => companion.id), [companions]);
  useEffect(() => {
    for (const id of companionIds) void openTicketOutput(id);
  }, [companionIds]);
  const companionEvents = useStore(
    agentOutput,
    useShallow((state): readonly (readonly AgentOutputEvent[])[] => companionIds.map((id) => selectTicketOutput(state, id))),
  );
  const companionSessions = useStore(
    agentTickets,
    useShallow((state) => companionIds.map((id) => state.byId.get(id)?.session ?? 'none')),
  );

  return useMemo(() => {
    if (!lead) return [];
    const second: CompanionAgentInput[] = companions.flatMap((record, index) =>
      record.companion
        ? [
            {
              id: record.id,
              name: record.companion.name,
              role: record.companion.role,
              model: record.model,
              branch: record.companion.role === 'reviewer' ? null : record.branch,
              session: companionSessions[index] ?? 'none',
              startedAt: record.createdAt,
            },
          ]
        : [],
    );
    return deriveAgents({
      lead: { id: lead.id, model: lead.model, branch: lead.branch, session: lead.session, tokens: tree?.leadTokens ?? null },
      subAgents: tree?.nodes ?? [],
      companions: second,
      events: [...leadEvents, ...companionEvents.flat()],
    });
  }, [lead, tree, leadEvents, companions, companionEvents, companionSessions]);
}
