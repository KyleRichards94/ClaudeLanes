import type { AgentOutputEvent, AgentOutputItem } from '@agent-lanes/contracts';

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
