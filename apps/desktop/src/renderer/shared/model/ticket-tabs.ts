import { create } from 'zustand';

/** The drill-in's tabs (artboard 3), in order. `design` is the Claude Design tab, its own route (AL-192). */
export const TICKET_TABS = ['output', 'diff', 'build-log', 'ado', 'room', 'design'] as const;
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

/**
 * Shows a drill-in tab. The diff is part of the Output & diff view: asking for `diff` (Review changes,
 * Open diff) shows that view with its diff pane open.
 */
export function setTicketPageTab(ticketId: string, requested: TicketPageTab): void {
  const tab: TicketPageTab = requested === 'diff' ? 'output' : requested;
  if (requested === 'diff') useOutputDiffLayoutStore.setState({ diffShown: true });
  useTicketTabs.setState(({ byTicket }) => (byTicket[ticketId] === tab ? {} : { byTicket: { ...byTicket, [ticketId]: tab } }));
}

/** Forgets every ticket's tab (tests). */
export function resetTicketPageTabs(): void {
  useTicketTabs.setState({ byTicket: {} });
}

/** How the drill-in's diff is drawn: one column with + and − lines, or old and new side by side. */
export type DiffView = 'unified' | 'split';

/** The Output & diff view's layout, shared by every ticket and kept for the session (in memory). */
export interface OutputDiffLayout {
  /** The diff pane is shown next to the output. */
  readonly diffShown: boolean;
  /** The output pane's share of the width (or height when stacked), 0–1. */
  readonly ratio: number;
  readonly diffView: DiffView;
  /** The diff pane scrolls to each file the agent edits. */
  readonly follow: boolean;
}

const useOutputDiffLayoutStore = create<OutputDiffLayout>()(() => ({ diffShown: true, ratio: 0.5, diffView: 'unified', follow: true }));

export function useOutputDiffLayout(): OutputDiffLayout {
  return useOutputDiffLayoutStore();
}

export function setOutputDiffLayout(change: Partial<OutputDiffLayout>): void {
  useOutputDiffLayoutStore.setState(change);
}

/** Back to the defaults (tests). */
export function resetOutputDiffLayout(): void {
  useOutputDiffLayoutStore.setState({ diffShown: true, ratio: 0.5, diffView: 'unified', follow: true });
}

/** The layout now, outside React (tests, recovery actions). */
export function outputDiffLayout(): OutputDiffLayout {
  return useOutputDiffLayoutStore.getState();
}

/** One field of the layout, so a component re-renders for it alone and not when the pane is dragged. */
export function useOutputDiffLayoutValue<T>(selector: (layout: OutputDiffLayout) => T): T {
  return useOutputDiffLayoutStore(selector);
}
