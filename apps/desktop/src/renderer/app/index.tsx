import { BoardPage } from '@/pages/board';
import { AppProviders } from './entrypoint/AppProviders';

export function App() {
  return (
    <AppProviders>
      <BoardPage />
    </AppProviders>
  );
}

export { AppErrorRoot } from './entrypoint/AppErrorRoot';
export { installErrorReporting } from './entrypoint/error-reporting';
