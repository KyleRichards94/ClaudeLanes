import { AppProviders } from './entrypoint/AppProviders';
import { BoardSync } from './entrypoint/BoardSync';
import { AppRouter } from './routing';
import { NewTicketHost } from './new-ticket';
import { ToastHost } from './toasts';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
      <NewTicketHost />
      <ToastHost />
      <BoardSync />
    </AppProviders>
  );
}

export { AppErrorRoot } from './entrypoint/AppErrorRoot';
export { installErrorReporting } from './entrypoint/error-reporting';
