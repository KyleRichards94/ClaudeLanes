import { LAUNCH_UNDO_WINDOW_MS, type LaunchFromAdoResponse } from '@agent-lanes/contracts';
import type { AgentTicketStore } from '@/entities/agent-ticket';
import { invoke, subscribe } from '@/shared/api';
import { LANE_LABELS } from '@/shared/config';
import { dismissToast, getToasts, toast } from '@/shared/model';

/** The success toast of a launch, by ticket: main replaces it under the same id when Undo can no longer run (AL-237). */
export function launchToastId(ticketId: string): string {
  return `launch-from-ado:${ticketId}`;
}

export const UNDO_LABEL = 'Undo';

export interface LaunchToastDeps {
  store: Pick<AgentTicketStore, 'remove'>;
  /** Refetches the team board and the ticket list once Undo has run. */
  refresh: () => void;
}

/** Whether the launch's toast still offers Undo. */
function offersUndo(id: string): boolean {
  return getToasts().some((entry) => entry.id === id && entry.actions.some((action) => action.label === UNDO_LABEL));
}

/** "Agent started in Planning" (artboard 10), or "Agent queued" at the concurrency cap. */
export function launchToastTitle(launched: Pick<LaunchFromAdoResponse, 'record' | 'status'>): string {
  return launched.status.state === 'queued' ? 'Agent queued' : `Agent started in ${LANE_LABELS[launched.record.stage]}`;
}

/** The toast without its Undo button: the summary stays for a few seconds as an info notice. */
function withoutUndo(id: string, launched: LaunchFromAdoResponse): void {
  if (!offersUndo(id)) return;
  toast({ id, tone: 'info', title: launchToastTitle(launched), body: launched.summary });
}

/**
 * The success toast of a team board launch (AL-237, T8, artboard 10): a polite notice of what changed
 * ("#71318 assigned to you and moved to In Progress · agent started in Planning") with a real Undo
 * button for 10 s, or until the agent's first turn ends. Undo asks main to put everything back.
 * Returns a function that stops the timer and the session watch (tests).
 */
export function showLaunchToast(launched: LaunchFromAdoResponse, deps: LaunchToastDeps): () => void {
  const id = launchToastId(launched.ticketId);
  let done = false;
  let unsubscribe: () => void = () => undefined;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    unsubscribe();
  };

  const undo = async () => {
    finish();
    const result = await invoke('agent:undoLaunch', { undoId: launched.undoId });
    deps.refresh();
    if (!result.ok) {
      toast({ id, tone: 'warning', title: 'Undo is no longer available', body: result.message });
      return;
    }
    deps.store.remove(launched.ticketId);
    toast({ id, tone: 'info', title: 'Launch undone', body: result.data.summary });
  };

  toast({ id, tone: 'success', title: launchToastTitle(launched), body: launched.summary, actions: [{ label: UNDO_LABEL, onPress: () => void undo() }] });

  const timer = setTimeout(() => {
    finish();
    withoutUndo(id, launched);
  }, LAUNCH_UNDO_WINDOW_MS);
  // The first turn ending closes Undo too (TB§4); main says so in the toast when the agent pushed or posted.
  try {
    unsubscribe = subscribe('agent:status', (status) => {
      if (status.ticketId !== launched.ticketId || (status.state !== 'idle' && status.state !== 'lost' && status.state !== 'stopped')) return;
      finish();
      withoutUndo(id, launched);
    });
  } catch {
    unsubscribe = () => undefined;
  }
  return () => {
    finish();
    dismissToast(id);
  };
}
