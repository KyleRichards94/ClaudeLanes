import { describe, expect, it } from 'vitest';
import { fakeAdoRow, fakeMcpRow } from '@/shared/testing';
import { agentTicketCountLabel, boardSubheader, mcpStatusOf, sprintRangeLabel } from './header';

describe('board header copy (AL-142)', () => {
  it('writes sprint dates as artboard 1 does', () => {
    expect(sprintRangeLabel({ start: '2026-10-07', finish: '2026-10-20' }, 2026)).toBe('7 – 20 Oct');
    expect(sprintRangeLabel({ start: '2026-09-28', finish: '2026-10-11' }, 2026)).toBe('28 Sep – 11 Oct');
    expect(sprintRangeLabel({ start: '2026-12-29', finish: '2027-01-11' }, 2026)).toBe('29 Dec 2026 – 11 Jan 2027');
    expect(sprintRangeLabel({ start: '2025-10-07', finish: '2025-10-20' }, 2026)).toBe('7 Oct 2025 – 20 Oct 2025');
    expect(sprintRangeLabel({ start: null, finish: '2026-10-20' }, 2026)).toBeNull();
  });

  it('builds the sub-header line', () => {
    const sprint = { name: 'Sprint 42', start: '2026-10-07', finish: '2026-10-20' };
    expect(boardSubheader(sprint, 8, 2026)).toBe('Sprint 42 · 7 – 20 Oct · 8 agent tickets');
    expect(boardSubheader({ ...sprint, start: null }, 1, 2026)).toBe('Sprint 42 · 1 agent ticket');
    expect(boardSubheader(null, 0)).toBe('0 agent tickets');
    expect(agentTicketCountLabel(1)).toBe('1 agent ticket');
  });

  it('sums up the saved MCP servers for the MCP pill', () => {
    expect(mcpStatusOf(undefined)).toBeNull();
    expect(mcpStatusOf([fakeAdoRow()])).toMatchObject({ label: 'No MCP servers', tone: 'neutral' });
    expect(mcpStatusOf([fakeMcpRow({ status: 'untested' })])).toMatchObject({ label: 'MCP untested' });
    expect(mcpStatusOf([fakeMcpRow({ status: 'ok' })])).toEqual({ label: 'MCP online', tone: 'ok', dot: true });
    expect(mcpStatusOf([fakeMcpRow({ status: 'ok' }), fakeMcpRow({ id: 'mcp:two', status: 'error' })])).toMatchObject({
      label: 'MCP offline',
      tone: 'danger',
    });
  });
});
