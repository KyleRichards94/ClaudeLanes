import { agentTicketEventHandlers } from '@/entities/agent-ticket';
import { windowVisibilityEventHandlers, type EventHandlers } from '@/shared/api';
import { toastEventHandlers } from '@/shared/model';

/**
 * The store handlers the app's event hub feeds (design §6: one subscription in `app/` routes events
 * into the Zustand stores). Each entity slice exports its handler map from its `index.ts`, for
 * example `agentTicketEventHandlers` from `@/entities/agent-ticket` (AL-141), and adds one line here.
 */
export const appEventHandlers: readonly EventHandlers[] = [
  agentTicketEventHandlers,
  // `toast` from main → the toast stack the app's ToastHost shows (AL-030).
  toastEventHandlers,
  // `app:window` from main → no ADO polling while the window is minimised or hidden (AL-066).
  windowVisibilityEventHandlers,
];
