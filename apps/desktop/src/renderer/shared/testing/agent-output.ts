import type { AgentGateEvent, AgentOutputEvent, AgentOutputItem, AgentStageEvent, Lane } from '@agent-lanes/contracts';

/**
 * A valid `agent:output` event (AL-102) for renderer tests: a line of assistant text by default.
 * `seq` defaults to `at`, so a list of events made from increasing times is in seq order.
 */
export function fakeOutputEvent(ticketId: string, at: number, overrides: { seq?: number; item?: AgentOutputItem } = {}): AgentOutputEvent {
  return {
    ticketId,
    at,
    seq: overrides.seq ?? at,
    item: overrides.item ?? { kind: 'text', streamId: `msg_${at}`, text: `line ${at}`, parentToolUseId: null },
  };
}

/** A valid `agent:stage` event (AL-103): by default the ticket moved from Planning to Implementing. */
export function fakeStageEvent(ticketId: string, at: number, overrides: Partial<Omit<AgentStageEvent, 'ticketId' | 'at'>> & { stage?: Lane } = {}): AgentStageEvent {
  return { ticketId, at, change: 'stage', stage: 'implementing', from: 'planning', activity: 'Plan approved', progress: 0, ...overrides };
}

/** A valid `agent:gate` event (AL-104): by default the plan waits for approval before Implementing. */
export function fakeGateEvent(ticketId: string, at: number, overrides: Partial<Omit<AgentGateEvent, 'ticketId' | 'at'>> = {}): AgentGateEvent {
  return { ticketId, at, state: 'waiting', stage: 'planning', from: 'planning', to: 'implementing', summary: 'Plan ready', note: null, ...overrides };
}
