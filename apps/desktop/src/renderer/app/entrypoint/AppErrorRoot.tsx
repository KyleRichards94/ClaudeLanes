import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/shared/ui';

/**
 * The outermost error boundary (design §12): a render error anywhere not caught closer to it is
 * logged (AL-214) and replaced by a panel with Retry and "Copy diagnostics" instead of a blank window.
 */
export function AppErrorRoot({ children }: { children?: ReactNode }) {
  return (
    <ErrorBoundary name="app" label="Agent Lanes" variant="page">
      {children}
    </ErrorBoundary>
  );
}
