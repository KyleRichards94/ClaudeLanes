import { ConnectionsModal } from './connections';
import { AppProviders } from './entrypoint/AppProviders';
import { AppRouter } from './routing';
import { ToastHost } from './toasts';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
      {/* Opened from the header, a Reconnect toast or first run (AL-046). */}
      <ConnectionsModal />
      <ToastHost />
    </AppProviders>
  );
}

export { AppErrorRoot } from './entrypoint/AppErrorRoot';
export { installErrorReporting } from './entrypoint/error-reporting';
