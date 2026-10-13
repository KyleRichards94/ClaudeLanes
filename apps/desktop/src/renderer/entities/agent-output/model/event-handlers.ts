import type { EventHandlers } from '@/shared/api';
import { noteOutputEvents } from '@/shared/model';
import { agentOutput, type AgentOutputStore } from './store';

/**
 * `agent:output` → the watched tickets' output streams, one store commit per frame (AL-015 batching).
 * What the live events settle (a file-changing tool call, a turn) is also noted for the queries that
 * read again after it (changed files, review findings; AL-276, AL-277).
 */
export function createAgentOutputEventHandlers(store: AgentOutputStore): EventHandlers {
  return {
    'agent:output': (events) => {
      store.receive(events);
      noteOutputEvents(events);
    },
  };
}

export const agentOutputEventHandlers: EventHandlers = createAgentOutputEventHandlers(agentOutput);
