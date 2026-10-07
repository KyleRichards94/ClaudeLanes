import type { EventHandlers } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from './store';

/**
 * The agent ticket store's handlers for the app's event hub (AL-015). `app/entrypoint/event-routes.ts`
 * registers `agentTicketEventHandlers` once; the hub hands `agent:output` over as one batch per
 * animation frame, so a burst of output is one store commit per frame.
 *
 * Only channels whose payloads carry something the store uses are handled. The other ticket events
 * are still the bare `{ ticketId, at }` envelope (AL-012); the tickets that add their fields add a
 * line here calling the matching store action:
 * `agent:stage` → `setStage` and `setActivity` (AL-103), `agent:gate` → `openGate` / `resolveGate`
 * (AL-104), `agent:status` → `setNeedsYou` for permissions (AL-109) and `applyModelChange` (AL-106),
 * `agent:subagent` → `setSubAgentCounts` (AL-107), `run:status` → `setRun` (AL-133), the build result
 * → `setLastBuild` (AL-132), and the pull request → `setPullRequest` (AL-181).
 */
export function createAgentTicketEventHandlers(store: AgentTicketStore): EventHandlers {
  return {
    'agent:output': (events) => store.recordOutput(events),
    'build:queued': (event) => store.applyBuildJob(event),
  };
}

export const agentTicketEventHandlers: EventHandlers = createAgentTicketEventHandlers(agentTickets);
