import type { EventHandlers } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from './store';

/**
 * The agent ticket store's handlers for the app's event hub (AL-015). `app/entrypoint/event-routes.ts`
 * registers `agentTicketEventHandlers` once; the hub hands `agent:output` over as one batch per
 * animation frame, so a burst of output is one store commit per frame.
 *
 * `agent:stage` (AL-103) and `agent:gate` (AL-104) are delivered as each event arrives, so a
 * `set_stage` call moves the card, and a waiting gate turns it amber, in the next frame. Only channels
 * whose payloads carry something the store uses are handled; the tickets that add fields to the other
 * ticket events add a line here calling the matching store action: `agent:status` → `setNeedsYou` for
 * permissions (AL-109), `agent:subagent` → `setSubAgentCounts`
 * (AL-107), `run:status` → `setRun` (AL-133), the build result → `setLastBuild` (AL-132), and the pull
 * request → `setPullRequest` (AL-181).
 */
export function createAgentTicketEventHandlers(store: AgentTicketStore): EventHandlers {
  return {
    'agent:output': (events) => store.recordOutput(events),
    'agent:stage': (event) => {
      if (event.change === 'stage') {
        store.setStage(event.ticketId, event.stage, event.at);
        // A new stage starts with its own activity line; none clears the previous stage's.
        store.setActivity(event.ticketId, { text: event.activity, progress: event.progress ?? undefined }, event.at);
      } else if (event.activity !== null) {
        store.setActivity(event.ticketId, { text: event.activity, progress: event.progress ?? undefined }, event.at);
      }
    },
    'agent:gate': (event) => {
      if (event.state === 'waiting') store.openGate(event.ticketId, event.stage, event.at);
      else store.resolveGate(event.ticketId);
    },
    // AL-106: what the session runs with, and the change that applies from its next turn.
    'agent:model': (event) => {
      store.applyModelChange(event.ticketId, { model: event.model, effort: event.effort });
      // No pending change (applied, or switched back): the switching pill clears.
      store.requestModelChange(event.ticketId, event.pending ?? { model: event.model, effort: event.effort }, event.at);
    },
    'build:queued': (event) => store.applyBuildJob(event),
  };
}

export const agentTicketEventHandlers: EventHandlers = createAgentTicketEventHandlers(agentTickets);
