import { useEffect, useMemo } from 'react';
import type { AgentOutputEvent, AgentSessionState, AgentSubagents, TicketRecord, TicketStageEntry } from '@agent-lanes/contracts';
import { useStore } from 'zustand';
import { shallow } from 'zustand/shallow';
import { useShallow } from 'zustand/react/shallow';
import { deriveAgents, type AgentView, type CompanionAgentInput } from '@/entities/agent';
import { agentOutput, openTicketOutput, selectTicketSkeleton, useAgentOutputSkeleton } from '@/entities/agent-output';
import { agentTickets, useAgentTicket, type AgentTicket } from '@/entities/agent-ticket';
import { useSubAgents } from '@/entities/sub-agent';
import { useTurnList, type Turn } from '@/entities/turn';
import { useNow } from '@/shared/model';

const NO_AGENTS: AgentView[] = [];
const NO_COMPANIONS: readonly TicketRecord[] = [];
const NO_TURNS: Turn[] = [];

/**
 * A ticket's turns (AL-278): derived from its output stream and stage history, so they replay after a
 * restart. The ticket's output is opened (backfilled and followed) if nothing opened it yet. Streamed text and
 * thinking do not re-derive them (`TicketOutput.skeleton`), so the live turn's duration runs on a one-second clock
 * instead of on its newest event. `null` is no ticket: no turns, nothing watched.
 */
export function useTurns(ticketId: string | null, history: readonly TicketStageEntry[]): Turn[] {
  const events = useAgentOutputSkeleton(ticketId);
  const turns = useTurnList(events, history);
  const live = turns.at(-1)?.endedAt === null;
  const now = useNow(live ? 1_000 : null);
  return useMemo(() => {
    if (ticketId === null) return NO_TURNS;
    const last = turns.at(-1);
    if (!last || last.endedAt !== null) return turns;
    // `now` may be older than the newest event before the clock first ticks; the turn never runs backwards.
    const durationMs = Math.max(last.durationMs, now - last.startedAt);
    return durationMs === last.durationMs ? turns : [...turns.slice(0, -1), { ...last, durationMs }];
  }, [ticketId, turns, now]);
}

interface AgentsInputs {
  readonly lead: AgentTicket;
  readonly tree: AgentSubagents | undefined;
  readonly leadEvents: readonly AgentOutputEvent[];
  readonly companions: readonly TicketRecord[];
  readonly companionEvents: readonly (readonly AgentOutputEvent[])[];
  readonly companionSessions: readonly AgentSessionState[];
}

/** The newest derivation per ticket, so every place that asks for a ticket's agents shares one result. */
const derived = new Map<string, { readonly inputs: AgentsInputs; readonly agents: AgentView[] }>();
const DERIVED_LIMIT = 16;

// A ticket whose output is forgotten (archived) leaves nothing behind.
agentOutput.subscribe((state) => {
  for (const id of derived.keys()) if (!state.byTicket.has(id)) derived.delete(id);
});

/** Empties the shared derivations (tests). */
export function resetAgentsCache(): void {
  derived.clear();
}

/** How many tickets have a shared derivation (tests). */
export function agentsCacheSize(): number {
  return derived.size;
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameInputs(a: AgentsInputs, b: AgentsInputs): boolean {
  return (
    a.lead === b.lead &&
    a.tree === b.tree &&
    a.leadEvents === b.leadEvents &&
    sameItems(a.companions, b.companions) &&
    sameItems(a.companionEvents, b.companionEvents) &&
    sameItems(a.companionSessions, b.companionSessions)
  );
}

function agentsOf(inputs: AgentsInputs): AgentView[] {
  const cached = derived.get(inputs.lead.id);
  if (cached && sameInputs(cached.inputs, inputs)) return cached.agents;

  const { lead, tree, leadEvents, companions, companionEvents, companionSessions } = inputs;
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
  const next = deriveAgents({
    lead: { id: lead.id, model: lead.model, branch: lead.branch, session: lead.session, tokens: tree?.leadTokens ?? null },
    subAgents: tree?.nodes ?? [],
    companions: second,
    events: companionEvents.length === 0 ? leadEvents : [...leadEvents, ...companionEvents.flat()],
  });
  // Nothing an agent shows changed: keep the array the views already have.
  const agents = cached && cached.agents.length === next.length && cached.agents.every((agent, index) => shallow(agent, next[index])) ? cached.agents : next;

  derived.delete(lead.id);
  derived.set(lead.id, { inputs, agents });
  if (derived.size > DERIVED_LIMIT) derived.delete(derived.keys().next().value!);
  return agents;
}

/**
 * Every agent of a ticket for both layouts (AL-278): the lead (the ticket), its sub-agents (the `agent:getSubagents`
 * tree, kept current by `agent:subagent` events) and the second agents in `companions` (their ticket records, from
 * `companionsOf`). Colours are assigned once in spawn order; `activeFile` and `activeKind` come from the output streams
 * of the lead and of each second agent. Empty until the lead's ticket is in the store.
 *
 * Derived from the output streams without their streamed text and thinking, and shared: callers with the same inputs get
 * the same array, which keeps its identity until something an agent shows changes.
 */
export function useAgents(ticketId: string, companions: readonly TicketRecord[] = NO_COMPANIONS): AgentView[] {
  const lead = useAgentTicket(ticketId);
  const tree = useSubAgents(ticketId).data;
  const leadEvents = useAgentOutputSkeleton(ticketId);

  const companionIds = useMemo(() => companions.map((companion) => companion.id), [companions]);
  useEffect(() => {
    for (const id of companionIds) void openTicketOutput(id);
  }, [companionIds]);
  const companionEvents = useStore(
    agentOutput,
    useShallow((state): readonly (readonly AgentOutputEvent[])[] => companionIds.map((id) => selectTicketSkeleton(state, id))),
  );
  const companionSessions = useStore(
    agentTickets,
    useShallow((state) => companionIds.map((id) => state.byId.get(id)?.session ?? 'none')),
  );

  return useMemo(
    () => (lead ? agentsOf({ lead, tree, leadEvents, companions, companionEvents, companionSessions }) : NO_AGENTS),
    [lead, tree, leadEvents, companions, companionEvents, companionSessions],
  );
}
