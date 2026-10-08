import { err, ok, type PopOutBacklogResponse } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';

/** The parts of a BrowserWindow the controller uses, so tests can pass a fake. */
export interface BacklogWindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  close(): void;
  once(event: 'closed', listener: () => void): unknown;
}

/** The popped-out Backlog window (AL-239, TB§5): one at a time, on one team. */
export interface BacklogWindowController {
  /**
   * Opens the window on a team (undefined: the profile's), or brings the open one to the front. The
   * open one is replaced when it shows another team. Throws when the window can't be created.
   */
  open(team: string | undefined): PopOutBacklogResponse;
  /** Closes it, if open (the main window closed: the app is quitting). */
  close(): void;
}

/** `create` makes and loads a new window on the team; null when there is no main window to pop out from. */
export function createBacklogWindowController(create: (team: string | undefined) => BacklogWindowLike | null): BacklogWindowController {
  let current: { window: BacklogWindowLike; team: string | undefined } | null = null;

  const live = () => (current && !current.window.isDestroyed() ? current : null);

  return {
    open(team) {
      const open = live();
      if (open && open.team === team) {
        if (open.window.isMinimized()) open.window.restore();
        open.window.focus();
        return { opened: false };
      }
      open?.window.close();
      const window = create(team);
      if (!window) throw new Error('There is no Agent Lanes window to pop the backlog out of.');
      const entry = { window, team };
      current = entry;
      window.once('closed', () => {
        if (current === entry) current = null;
      });
      return { opened: true };
    },
    close() {
      live()?.window.close();
      current = null;
    },
  };
}

/** `app:popOutBacklog`. A window that can't be created is reported, not thrown across IPC. */
export function createBacklogWindowHandlers(services: { backlogWindow: BacklogWindowController }): HandlersFor<'app:popOutBacklog'> {
  return {
    'app:popOutBacklog': (request) => {
      try {
        return ok(services.backlogWindow.open(request.team));
      } catch (error) {
        return err('INTERNAL', error instanceof Error ? error.message : String(error));
      }
    },
  };
}
