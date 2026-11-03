import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** The board's Rooms panel (AL-295): open or not, the room it shows, and the message to scroll to. */
interface RoomsPanelState {
  readonly open: boolean;
  /** Null shows the first room. */
  readonly room: string | null;
  /** A message to bring into view, e.g. the first unread one the Assist bubble points at. */
  readonly focus: string | null;
}

const roomsPanel = createStore<RoomsPanelState>()(() => ({ open: false, room: null, focus: null }));

export function openRooms(room: string | null = null, focus: string | null = null): void {
  roomsPanel.setState({ open: true, room, focus });
}

export function showRoom(room: string): void {
  roomsPanel.setState({ room, focus: null });
}

export function closeRooms(): void {
  roomsPanel.setState({ open: false, focus: null });
}

export function useRoomsPanel<T>(select: (state: RoomsPanelState) => T): T {
  return useStore(roomsPanel, select);
}
