import { copyDiagnostics } from '@/shared/api';
import { openConnections, setTicketPageTab, toast } from '@/shared/model';
import { routes, type Route } from '@/shared/routing';
import type { RecoveryEnvironment } from './toast-intents';

/**
 * The app's side of each error recovery (AL-211): the Connections modal, the drill-in's tabs and
 * Copy diagnostics. `navigate` is the router's.
 */
export function createRecoveryEnvironment(navigate: (route: Route) => void): RecoveryEnvironment {
  const openTicketTab = (ticketId: string, tab: Parameters<RecoveryEnvironment['openTicketTab']>[1]) => {
    setTicketPageTab(ticketId, tab);
    navigate(routes.ticket(ticketId));
  };
  return {
    openConnections,
    openTicketTab,
    // No reconnect channel yet (AL-110; `agent:resume` only lifts a pause, AL-105): the drill-in's Output
    // is where the session's state shows; AL-110 replaces this with a resume from the saved session id.
    reconnectSession: (ticketId) => openTicketTab(ticketId, 'output'),
    copyDiagnostics: () => {
      void copyDiagnostics().then((result) =>
        toast(
          result.ok
            ? { id: 'diagnostics-copied', tone: 'info', title: 'Diagnostics copied', body: 'Paste them into your bug report. No tokens are included.' }
            : { id: 'diagnostics-copied', tone: 'error', title: "Couldn't copy diagnostics", body: result.message },
        ),
      );
    },
  };
}
