import { AppProviders } from './entrypoint/AppProviders';
import { AppRouter } from './routing';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}

export { AppErrorRoot } from './entrypoint/AppErrorRoot';
export { installErrorReporting } from './entrypoint/error-reporting';
