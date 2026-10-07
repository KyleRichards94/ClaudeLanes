import type { EventHandlers } from '@/shared/api';
import { agentOutput, type AgentOutputStore } from './store';

/** `agent:output` → the watched tickets' output streams, one store commit per frame (AL-015 batching). */
export function createAgentOutputEventHandlers(store: AgentOutputStore): EventHandlers {
  return {
    'agent:output': (events) => store.receive(events),
  };
}

export const agentOutputEventHandlers: EventHandlers = createAgentOutputEventHandlers(agentOutput);
