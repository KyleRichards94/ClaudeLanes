import { create } from 'zustand';
import type { DesignViewState } from '@agent-lanes/contracts';
import type { EventHandlers } from '@/shared/api';

interface DesignViewsState {
  /** Each ticket's live Claude Design view as main last reported it; absent when it has none. */
  readonly byTicket: Readonly<Record<string, DesignViewState>>;
}

/**
 * What main says about each ticket's canvas view (AL-191 `design:view`): loading, signed in, signed
 * out or failed, its page and whether it is on screen. Drives the design tab's "Webview · signed in"
 * pill (AL-192) and the offer to switch to MCP link mode (AL-194).
 */
const useDesignViews = create<DesignViewsState>()(() => ({ byTicket: {} }));

/** Records a view state from `design:open` or `design:getView`; null forgets the ticket's view. */
export function setDesignViewState(ticketId: string, view: DesignViewState | null): void {
  useDesignViews.setState(({ byTicket }) => {
    if (view === null) {
      if (!(ticketId in byTicket)) return {};
      return { byTicket: Object.fromEntries(Object.entries(byTicket).filter(([id]) => id !== ticketId)) };
    }
    return { byTicket: { ...byTicket, [ticketId]: view } };
  });
}

export function useDesignViewState(ticketId: string): DesignViewState | undefined {
  return useDesignViews((state) => state.byTicket[ticketId]);
}

/** Forgets every view (tests). */
export function resetDesignViews(): void {
  useDesignViews.setState({ byTicket: {} });
}

/** Registered with the app's event hub. */
export const designViewEventHandlers: EventHandlers = {
  'design:view': ({ ticketId, status, url, visible, closed }) => {
    setDesignViewState(ticketId, closed ? null : { ticketId, status, url, visible });
  },
};
