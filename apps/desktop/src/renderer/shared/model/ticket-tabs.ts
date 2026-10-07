import { create } from 'zustand';

/** The drill-in's tabs (artboard 3), in order. `design` is the Claude Design tab, its own route (AL-192). */
export const TICKET_TABS = ['output', 'diff', 'build-log', 'ado', 'design'] as const;
export type TicketTab = (typeof TICKET_TABS)[number];
/** The tabs shown inside the drill-in page itself. */
export type TicketPageTab = Exclude<TicketTab, 'design'>;

interface TicketTabsState {
  /** The tab each ticket's drill-in last showed, so coming back from the design tab lands on it. */
  readonly byTicket: Readonly<Record<string, TicketPageTab>>;
}

/** In memory only (design §6 "local UI state"); a restart opens every ticket on Output. */
const useTicketTabs = create<TicketTabsState>()(() => ({ byTicket: {} }));

export function useTicketPageTab(ticketId: string): TicketPageTab {
  return useTicketTabs((state) => state.byTicket[ticketId] ?? 'output');
}

export function setTicketPageTab(ticketId: string, tab: TicketPageTab): void {
  useTicketTabs.setState(({ byTicket }) => (byTicket[ticketId] === tab ? {} : { byTicket: { ...byTicket, [ticketId]: tab } }));
}

/** Forgets every ticket's tab (tests). */
export function resetTicketPageTabs(): void {
  useTicketTabs.setState({ byTicket: {} });
}
