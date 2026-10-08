import { BacklogPopout } from '@/widgets/backlog-popout';

/**
 * The popped-out Backlog window (AL-239, TB§5): the Backlog popout filling its own window, for a second
 * monitor. Its rows are native drag sources the main window's lanes take; closing it closes the window.
 */
export function BacklogWindowPage({ teamId }: { teamId: string | null }) {
  return <BacklogPopout visible mode="window" teamId={teamId} onClose={() => globalThis.close()} />;
}
