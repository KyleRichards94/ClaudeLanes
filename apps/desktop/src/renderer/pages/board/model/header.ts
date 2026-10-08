import type { Sprint } from '@agent-lanes/contracts';

/**
 * What the board header says (AL-142, artboard 1): the sprint's dates in the sub-header
 * ("Sprint 42 · 7 – 20 Oct · 8 agent tickets"). The MCP pill is the live per-session `McpStatusPill` (AL-108).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

interface Day {
  year: number;
  month: number;
  day: number;
}

/** A `YYYY-MM-DD` calendar day; sprint dates are days, not instants (AL-061). */
function parseDay(value: string): Day | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function monthOf(day: Day): string {
  return MONTHS[day.month - 1] ?? '';
}

/**
 * "7 – 20 Oct", "28 Sep – 11 Oct", or with years when the sprint crosses one or is not in
 * `currentYear` ("29 Dec 2026 – 11 Jan 2027"). Null when ADO has no dates for the sprint.
 */
export function sprintRangeLabel(sprint: Pick<Sprint, 'start' | 'finish'>, currentYear: number = new Date().getFullYear()): string | null {
  const start = sprint.start ? parseDay(sprint.start) : undefined;
  const finish = sprint.finish ? parseDay(sprint.finish) : undefined;
  if (!start || !finish) return null;
  if (start.year !== finish.year || finish.year !== currentYear) {
    return `${start.day} ${monthOf(start)} ${start.year} – ${finish.day} ${monthOf(finish)} ${finish.year}`;
  }
  if (start.month === finish.month) return `${start.day} – ${finish.day} ${monthOf(finish)}`;
  return `${start.day} ${monthOf(start)} – ${finish.day} ${monthOf(finish)}`;
}

/** "1 agent ticket", "8 agent tickets". */
export function agentTicketCountLabel(count: number): string {
  return `${count} agent ${count === 1 ? 'ticket' : 'tickets'}`;
}

/** The sub-header line: "Sprint 42 · 7 – 20 Oct · 8 agent tickets"; just the count without a sprint. */
export function boardSubheader(sprint: Pick<Sprint, 'name' | 'start' | 'finish'> | null, ticketCount: number, currentYear?: number): string {
  const parts = sprint ? [sprint.name, sprintRangeLabel(sprint, currentYear)] : [];
  return [...parts, agentTicketCountLabel(ticketCount)].filter(Boolean).join(' · ');
}
