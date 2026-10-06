import { BoardPage } from '@/pages/board';
import { AppProviders } from './entrypoint/AppProviders';

export function App() {
  return (
    <AppProviders>
      <BoardPage />
    </AppProviders>
  );
}
