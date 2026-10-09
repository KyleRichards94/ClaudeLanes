import { create } from 'zustand';

/**
 * Which tool rows are open (AL-256), by ticket and row key. Kept outside the stream's component so
 * a row that scrolls out of the virtual window and back comes back as it was, and the state survives
 * leaving and reopening the ticket. In memory only, like the other local UI state (design §6).
 */
interface ExpandedRowsState {
  readonly byTicket: Readonly<Record<string, ReadonlySet<string>>>;
}

const useExpandedRows = create<ExpandedRowsState>()(() => ({ byTicket: {} }));

export function useRowExpanded(ticketId: string, rowKey: string): boolean {
  return useExpandedRows((state) => state.byTicket[ticketId]?.has(rowKey) ?? false);
}

export function toggleRowExpanded(ticketId: string, rowKey: string): void {
  useExpandedRows.setState(({ byTicket }) => {
    const current = byTicket[ticketId] ?? new Set<string>();
    const next = new Set(current);
    if (next.has(rowKey)) next.delete(rowKey);
    else next.add(rowKey);
    return { byTicket: { ...byTicket, [ticketId]: next } };
  });
}

/** Opens a row (AL-261: a Spawn row a sub-agent card points at); already-open rows stay open. */
export function expandRow(ticketId: string, rowKey: string): void {
  useExpandedRows.setState(({ byTicket }) => {
    const current = byTicket[ticketId] ?? new Set<string>();
    if (current.has(rowKey)) return {};
    return { byTicket: { ...byTicket, [ticketId]: new Set([...current, rowKey]) } };
  });
}

export function isRowExpanded(ticketId: string, rowKey: string): boolean {
  return useExpandedRows.getState().byTicket[ticketId]?.has(rowKey) ?? false;
}

/** Forgets every open row (tests). */
export function resetExpandedRows(): void {
  useExpandedRows.setState({ byTicket: {} });
}
