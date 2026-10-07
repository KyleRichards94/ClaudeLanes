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
    // No session manager yet (AL-100/AL-110): the drill-in's Output is where the session's state and
    // its resume will show; AL-110 replaces this with a resume from the saved session id.
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
