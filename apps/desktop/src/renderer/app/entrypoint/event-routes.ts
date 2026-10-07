import { agentTicketEventHandlers } from '@/entities/agent-ticket';
import type { EventHandlers } from '@/shared/api';

/**
 * The store handlers the app's event hub feeds (design §6: one subscription in `app/` routes events
 * into the Zustand stores). Each entity slice exports its handler map from its `index.ts`, for
 * example `agentTicketEventHandlers` from `@/entities/agent-ticket` (AL-141), and adds one line here.
 */
export const appEventHandlers: readonly EventHandlers[] = [
  agentTicketEventHandlers,
];
