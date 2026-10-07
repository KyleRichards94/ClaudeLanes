import { AppProviders } from './entrypoint/AppProviders';
import { AppRouter } from './routing';
import { NewTicketHost } from './new-ticket';
import { ToastHost } from './toasts';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
      <NewTicketHost />
      <ToastHost />
    </AppProviders>
  );
}

export { AppErrorRoot } from './entrypoint/AppErrorRoot';
export { installErrorReporting } from './entrypoint/error-reporting';
