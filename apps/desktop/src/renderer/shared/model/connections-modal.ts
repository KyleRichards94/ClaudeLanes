import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ConnectionId, ConnectionKind } from '@agent-lanes/contracts';

/**
 * Where the Connections modal is (AL-046, design §8): open or not, which tab, and the saved row a
 * "Reconnect" asked for. It opens from the board header, from a toast's Reconnect action and from the
 * first-run flow (AL-047), so its state is app-wide; the app layer draws the modal.
 */
export interface ConnectionsModalState {
  readonly open: boolean;
  /** First run (AL-047): no close button, no Esc, no Cancel; it closes when the flow says so. */
  readonly blocking: boolean;
  readonly tab: ConnectionKind;
  /** The saved row to land on, with its token field focused for a new token; null for none. */
  readonly target: ConnectionId | null;
  /** Goes up on every open, so opening again on the same row focuses its field again. */
  readonly request: number;
}

export interface OpenConnectionsOptions {
  /** The tab to show. Defaults to the target's kind, else Azure DevOps. */
  tab?: ConnectionKind;
  /** Lands on this saved row with its token field focused (a reconnect). */
  connectionId?: ConnectionId;
  /** Opens as the first-run modal that can't be dismissed (AL-047). */
  blocking?: boolean;
}

const initialState: ConnectionsModalState = { open: false, blocking: false, tab: 'ado', target: null, request: 0 };

const connectionsModalStore = createStore<ConnectionsModalState>()(() => initialState);

/** The kind of connection an id names: `ado:…`, `mcp:…` or `claude`. */
export function connectionKindOf(id: ConnectionId): ConnectionKind {
  if (id === 'claude') return 'claude';
  return id.startsWith('mcp:') ? 'mcp' : 'ado';
}

/** Opens the Connections modal, optionally on a tab or on a saved row to reconnect. */
export function openConnections({ tab, connectionId, blocking }: OpenConnectionsOptions = {}): void {
  connectionsModalStore.setState(({ request, blocking: wasBlocking, open }) => ({
    open: true,
    // A first-run modal stays blocking until the flow ends it, whatever opens it meanwhile.
    blocking: blocking ?? (open && wasBlocking),
    tab: tab ?? (connectionId ? connectionKindOf(connectionId) : 'ado'),
    target: connectionId ?? null,
    request: request + 1,
  }));
}

/** Closes the modal. A blocking modal ignores this; `endBlockingConnections` closes it. */
export function closeConnections(): void {
  connectionsModalStore.setState((state) => (state.blocking || !state.open ? state : { ...state, open: false, target: null }));
}

/** First run is done (AL-047): the blocking modal closes. */
export function endBlockingConnections(): void {
  connectionsModalStore.setState((state) => (state.blocking ? { ...state, open: false, blocking: false, target: null } : state));
}

/** Switches tab inside the open modal, leaving any reconnect target behind. */
export function showConnectionsTab(tab: ConnectionKind): void {
  connectionsModalStore.setState((state) => (state.tab === tab ? state : { ...state, tab }));
}

export function getConnectionsModal(): ConnectionsModalState {
  return connectionsModalStore.getState();
}

export function useConnectionsModal<T>(selector: (state: ConnectionsModalState) => T): T {
  return useStore(connectionsModalStore, selector);
}

/** Back to closed (tests). */
export function resetConnectionsModal(): void {
  connectionsModalStore.setState(initialState, true);
}
