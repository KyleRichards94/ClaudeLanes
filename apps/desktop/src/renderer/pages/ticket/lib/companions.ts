import type { TicketCompanion, TicketCompanionRole, TicketRecord } from '@agent-lanes/contracts';

/** The second agents of a ticket (AL-266), oldest first: records marked `companion.of` the lead. */
export function companionsOf(records: readonly TicketRecord[] | undefined, leadId: string): TicketRecord[] {
  return (records ?? []).filter((record) => record.companion?.of === leadId).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

export const COMPANION_ROLE_LABELS: Readonly<Record<TicketCompanionRole, string>> = { reviewer: 'Reviewer', helper: 'Helper' };

/** "Eyes · Reviewer", for the switcher and the Agents card. */
export function companionLabel(companion: TicketCompanion): string {
  return `${companion.name} · ${COMPANION_ROLE_LABELS[companion.role]}`;
}

/** What the Agents card says under a companion: read-only, or its branch. */
export function companionDetail(record: Pick<TicketRecord, 'branch'> & { companion: TicketCompanion }): string {
  return record.companion.role === 'reviewer' ? 'Read-only, in the ticket worktree' : record.branch;
}
