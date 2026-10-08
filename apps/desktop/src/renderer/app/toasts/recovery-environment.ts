import { copyDiagnostics, reconnectSession } from '@/shared/api';
import { openConnections, setTicketPageTab, toast } from '@/shared/model';
import { routes, type Route } from '@/shared/routing';
import type { RecoveryEnvironment } from './toast-intents';

/**
 * The app's side of each error recovery (AL-211): the Connections modal, the drill-in's tabs,
 * Reconnect (AL-110) and Copy diagnostics. `navigate` is the router's.
 */
export function createRecoveryEnvironment(navigate: (route: Route) => void): RecoveryEnvironment {
  const openTicketTab = (ticketId: string, tab: Parameters<RecoveryEnvironment['openTicketTab']>[1]) => {
    setTicketPageTab(ticketId, tab);
    navigate(routes.ticket(ticketId));
  };
  return {
    openConnections,
    openTicketTab,
    // Resumes the lost session from its saved session id in the same worktree (agent:reconnect, AL-110);
    // a failure is shown as a toast of its own.
    reconnectSession: (ticketId) => {
      void reconnectSession(ticketId).then((problem) => {
        if (problem) toast({ id: `reconnect-failed:${ticketId}`, tone: 'error', title: `Couldn't reconnect ${ticketId}`, body: problem });
      });
    },
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
