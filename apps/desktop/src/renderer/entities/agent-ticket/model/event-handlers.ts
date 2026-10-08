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
 * permissions (AL-109) and the pull request → `setPullRequest` (AL-181). `agent:model` (AL-106),
 * `agent:subagent` (AL-107), `agent:permission` (AL-109), `run:status` → `setRun` and `build:finished`
 * → `setLastBuild` (AL-173) are handled.
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
    // AL-107: the card's "N sub-agents" follows the SDK's task states.
    'agent:subagent': (event) => store.setSubAgentCounts(event.ticketId, event.counts),
    'build:queued': (event) => store.applyBuildJob(event),
    // The Create PR stage's pull request (AL-181): "PR !10612 · 3 / 4 checks" on the card.
    'pr:status': (event) => store.setPullRequest(event.ticketId, { id: event.pullRequestId, status: event.status, checks: event.checks }),
    // A tool call outside the permission policy waits (AL-109): "Needs you · allow Bash" while one does.
    'agent:permission': (event) => {
      if (event.waiting) store.setNeedsYou(event.ticketId, { kind: 'permission', tool: event.waiting.tool, since: event.waiting.openedAt });
      else store.clearNeedsYou(event.ticketId, 'permission');
    },
    // "Design v2" / "Design v3 not yet used" on the card and in the live dock (AL-200).
    'design:spec': (event) => store.setDesignSpec(event.ticketId, event.version, event.change, event.at),
    // The Worktree panel's Build / Run / Stop and status lines follow these (AL-173).
    'run:status': ({ ticketId, state, url, startedAt }) => store.setRun(ticketId, { state, url, startedAt }),
    'build:finished': (result) =>
      store.setLastBuild(result.ticketId, {
        outcome: result.outcome,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        errors: result.errors,
        warnings: result.warnings,
        firstError: result.diagnostics.find((item) => item.severity === 'error') ?? null,
      }),
  };
}

export const agentTicketEventHandlers: EventHandlers = createAgentTicketEventHandlers(agentTickets);
