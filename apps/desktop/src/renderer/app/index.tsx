import { AppProviders } from './entrypoint/AppProviders';
import { AppRouter } from './routing';
import { ToastHost } from './toasts';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
      <ToastHost />
    </AppProviders>
  );
}

export { AppErrorRoot } from './entrypoint/AppErrorRoot';
export { installErrorReporting } from './entrypoint/error-reporting';
