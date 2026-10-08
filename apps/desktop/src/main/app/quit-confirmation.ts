/**
 * Asks before quitting while agents are mid-turn (AL-213, design §10). Closing the app stops every
 * session it started, so an agent in a turn would be cut off; idle and paused sessions are saved and
 * resume later without asking.
 *
 * `hold(proceed)` is called from a cancellable event (the main window's `close`, the app's
 * `before-quit`). It returns true when the event must be prevented: agents are mid-turn and the user
 * has not agreed yet. One question is shown at a time; once the user agrees, `proceed` runs and every
 * later `hold` lets the quit through.
 */
export interface QuitConfirmationOptions {
  /** Tickets whose agent is in a turn right now (`SessionManager.midTurn`). */
  midTurn(): readonly string[];
  /** Asks the user; resolves true to quit anyway. */
  confirm(ticketIds: readonly string[]): Promise<boolean>;
}

export interface QuitConfirmation {
  hold(proceed: () => void): boolean;
}

export function createQuitConfirmation(options: QuitConfirmationOptions): QuitConfirmation {
  let agreed = false;
  let asking = false;
  return {
    hold(proceed) {
      if (agreed) return false;
      const busy = options.midTurn();
      if (busy.length === 0) return false;
      if (asking) return true;
      asking = true;
      void options
        .confirm(busy)
        .catch(() => false)
        .then((quit) => {
          asking = false;
          if (!quit) return;
          agreed = true;
          proceed();
        });
      return true;
    },
  };
}

/** The question's text: how many agents, and what quitting does to them. */
export function quitQuestion(ticketIds: readonly string[]): { message: string; detail: string } {
  const count = ticketIds.length;
  const list = ticketIds.map((id) => `#${id}`).join(', ');
  return {
    message: count === 1 ? `An agent is mid-turn (${list}).` : `${count} agents are mid-turn (${list}).`,
    detail:
      'Quitting stops them now and cuts the current turn short. Each session and its worktree are kept, so the agent can be resumed later.',
  };
}
