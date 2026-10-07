import { AppProviders } from './entrypoint/AppProviders';
import { AppRouter } from './routing';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
