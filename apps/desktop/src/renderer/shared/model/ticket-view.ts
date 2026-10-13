import { create } from 'zustand';
import { outputDiffLayout, resetOutputDiffLayout, setOutputDiffLayout, useOutputDiffLayoutValue, type DiffView } from './ticket-tabs';

/**
 * What both ticket layouts (Flight deck and Code City, AL-275) share, so the selection survives a
 * switch of layout:
 * - `selectedFilePath`: the highlighted change-map tile or building, and the file shown in the diff;
 * - `selectedTurn`: the highlighted turn and where the output sits (Flight deck; kept for the way back);
 * - `followAgent`: the diff, or the selection, jumps to the file the running agent edits;
 * - `diffMode`: the diff drawn unified or side by side.
 *
 * `selectedFilePath` and `selectedTurn` are per ticket and in memory. `followAgent` and `diffMode` are the
 * Output & diff view's `follow` and `diffView` (`ticket-tabs.ts`): this module keeps no second copy, it
 * reads and writes that layout, so Flight deck and Code City (and any other reader of the layout) always agree (they
 * apply to every ticket, as they always did). The composer draft lives in the UI prefs (`composerDrafts`).
 */
export interface TicketView {
  readonly selectedFilePath: string | null;
  readonly followAgent: boolean;
  readonly diffMode: DiffView;
  readonly selectedTurn: number | null;
}

interface TicketSelection {
  readonly selectedFilePath: string | null;
  readonly selectedTurn: number | null;
}

const NO_SELECTION: TicketSelection = { selectedFilePath: null, selectedTurn: null };

const useSelectionStore = create<{ readonly byTicket: Readonly<Record<string, TicketSelection>> }>()(() => ({ byTicket: {} }));

function patchSelection(ticketId: string, change: Partial<TicketSelection>) {
  useSelectionStore.setState(({ byTicket }) => {
    const before = byTicket[ticketId] ?? NO_SELECTION;
    const next = { ...before, ...change };
    if (next.selectedFilePath === before.selectedFilePath && next.selectedTurn === before.selectedTurn) return {};
    return { byTicket: { ...byTicket, [ticketId]: next } };
  });
}

/** A ticket's shared view state; select one field (`(view) => view.selectedFilePath`) to re-render for it alone. */
export function useTicketView<T>(ticketId: string, selector: (view: TicketView) => T): T {
  const selection = useSelectionStore((state) => state.byTicket[ticketId] ?? NO_SELECTION);
  const followAgent = useOutputDiffLayoutValue((layout) => layout.follow);
  const diffMode = useOutputDiffLayoutValue((layout) => layout.diffView);
  return selector({ ...selection, followAgent, diffMode });
}

export const useSelectedFilePath = (ticketId: string): string | null => useTicketView(ticketId, (view) => view.selectedFilePath);
export const useSelectedTurn = (ticketId: string): number | null => useTicketView(ticketId, (view) => view.selectedTurn);
export const useFollowAgent = (ticketId: string): boolean => useTicketView(ticketId, (view) => view.followAgent);
export const useDiffMode = (ticketId: string): DiffView => useTicketView(ticketId, (view) => view.diffMode);

/** The view now, outside React (event handlers, tests). */
export function getTicketView(ticketId: string): TicketView {
  const selection = useSelectionStore.getState().byTicket[ticketId] ?? NO_SELECTION;
  const { follow, diffView } = outputDiffLayout();
  return { ...selection, followAgent: follow, diffMode: diffView };
}

/** Selects a changed file (its worktree-relative path), in either layout. */
export function selectFile(ticketId: string, path: string): void {
  patchSelection(ticketId, { selectedFilePath: path });
}

/** Clears the file selection (Esc, or a click on empty ground). */
export function clearSelection(ticketId: string): void {
  patchSelection(ticketId, { selectedFilePath: null });
}

/** Selects a turn (1-based index) in the turn strip, or none with `null`. */
export function selectTurn(ticketId: string, turn: number | null): void {
  patchSelection(ticketId, { selectedTurn: turn });
}

/** Follow agent on or off. Shared by every ticket, as the Output & diff view's switch always was. */
export function setFollowAgent(_ticketId: string, follow: boolean): void {
  setOutputDiffLayout({ follow });
}

/** Unified or side by side. Shared by every ticket. */
export function setDiffMode(_ticketId: string, diffMode: DiffView): void {
  setOutputDiffLayout({ diffView: diffMode });
}

/** Forgets every selection and puts follow and diff mode back to their defaults (tests). */
export function resetTicketViews(): void {
  useSelectionStore.setState({ byTicket: {} });
  resetOutputDiffLayout();
}
