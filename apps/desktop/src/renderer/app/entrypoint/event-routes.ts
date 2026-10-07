import { agentOutputEventHandlers } from '@/entities/agent-output';
import { agentTicketEventHandlers } from '@/entities/agent-ticket';
import type { EventHandlers } from '@/shared/api';
import { toastEventHandlers } from '@/shared/model';

/**
 * The store handlers the app's event hub feeds (design §6: one subscription in `app/` routes events
 * into the Zustand stores). Each entity slice exports its handler map from its `index.ts`, for
 * example `agentTicketEventHandlers` from `@/entities/agent-ticket` (AL-141), and adds one line here.
 */
export const appEventHandlers: readonly EventHandlers[] = [
  agentTicketEventHandlers,
  // `agent:output` → the output stream of each ticket a view watches (AL-102).
  agentOutputEventHandlers,
  // `toast` from main → the toast stack the app's ToastHost shows (AL-030).
  toastEventHandlers,
];
