import { create } from 'zustand';

interface ArtboardSelectionState {
  /** Each ticket's checked artboard ids, in the order they were checked. */
  readonly byTicket: Readonly<Record<string, readonly string[]>>;
}

/**
 * The "Hand off to agent" checklist (artboard 4, AL-195): which artboards the user picked to ship.
 * Claude Design offers no way to read the canvas's own selection (D117), so this checklist is the
 * selection in both embed modes. In memory; AL-197 reads it when shipping.
 */
const useArtboardSelection = create<ArtboardSelectionState>()(() => ({ byTicket: {} }));

const NONE: readonly string[] = [];

export function useSelectedArtboards(ticketId: string): readonly string[] {
  return useArtboardSelection((state) => state.byTicket[ticketId] ?? NONE);
}

export function getSelectedArtboards(ticketId: string): readonly string[] {
  return useArtboardSelection.getState().byTicket[ticketId] ?? NONE;
}

export function toggleArtboard(ticketId: string, artboardId: string): void {
  useArtboardSelection.setState(({ byTicket }) => {
    const current = byTicket[ticketId] ?? NONE;
    const next = current.includes(artboardId) ? current.filter((id) => id !== artboardId) : [...current, artboardId];
    return { byTicket: { ...byTicket, [ticketId]: next } };
  });
}

/** Drops picks that are no longer on the canvas (an artboard was removed or renamed). */
export function keepSelectedArtboards(ticketId: string, artboardIds: readonly string[]): void {
  useArtboardSelection.setState(({ byTicket }) => {
    const current = byTicket[ticketId] ?? NONE;
    const present = new Set(artboardIds);
    const next = current.filter((id) => present.has(id));
    return next.length === current.length ? {} : { byTicket: { ...byTicket, [ticketId]: next } };
  });
}

/** Forgets every pick (tests). */
export function resetArtboardSelection(): void {
  useArtboardSelection.setState({ byTicket: {} });
}
