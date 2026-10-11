import { describe, expect, it } from 'vitest';
import { TICKET_MENU, descriptionText, ticketMenuItems } from './menu';

const ticket = { id: '71273', ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 }, branch: '71273-cutover', stage: 'implementing' as const, session: 'stopped' as const };

describe('ticket context menu items (AL-270)', () => {
  it('lists work item, agent, worktree and removal actions, disabled where there is nothing to act on', () => {
    const items = ticketMenuItems({ ticket, workItem: { state: 'Active', webUrl: 'https://dev.azure.com/contoso/p/_workitems/edit/71273', description: '<p>Do it</p>' }, resumable: true });
    expect(items.map((item) => item.key)).toEqual([
      TICKET_MENU.openAdo,
      TICKET_MENU.description,
      TICKET_MENU.adoState,
      TICKET_MENU.moveStage,
      TICKET_MENU.resume,
      TICKET_MENU.openWorktree,
      TICKET_MENU.copyBranch,
      TICKET_MENU.remove,
    ]);
    expect(items.find((item) => item.key === TICKET_MENU.adoState)).toMatchObject({ detail: 'Now Active', disabled: false });
    expect(items.find((item) => item.key === TICKET_MENU.moveStage)).toMatchObject({ detail: 'Now Implementing' });
    expect(items.find((item) => item.key === TICKET_MENU.resume)).toMatchObject({ label: 'Resume session', disabled: false });
    expect(items.find((item) => item.key === TICKET_MENU.remove)).toMatchObject({ danger: true, section: 'Ticket' });

    // While the work item has not loaded, its actions wait; a running session cannot be resumed; a lost one reconnects.
    const loading = ticketMenuItems({ ticket: { ...ticket, session: 'running' }, workItem: undefined, resumable: true });
    expect(loading.filter((item) => item.section === 'Work item').every((item) => item.disabled)).toBe(true);
    expect(loading.find((item) => item.key === TICKET_MENU.resume)?.disabled).toBe(true);
    expect(ticketMenuItems({ ticket: { ...ticket, session: 'lost' }, resumable: true }).find((item) => item.key === TICKET_MENU.resume)?.label).toBe('Reconnect session');
    expect(ticketMenuItems({ ticket: { ...ticket, session: 'none' }, resumable: false }).find((item) => item.key === TICKET_MENU.resume)?.disabled).toBe(true);
  });

  it('has no work item actions for a No-ticket or PR review card', () => {
    const items = ticketMenuItems({ ticket: { ...ticket, id: 'pr-11635-review', ado: null }, resumable: false });
    expect(items.map((item) => item.key)).toEqual([TICKET_MENU.moveStage, TICKET_MENU.resume, TICKET_MENU.openWorktree, TICKET_MENU.copyBranch, TICKET_MENU.remove]);
  });

  it('turns an ADO description into readable text', () => {
    expect(descriptionText('<div>Export the list.</div><ul><li>CSV</li><li>XLSX &amp; PDF</li></ul>')).toBe('Export the list.\n- CSV\n- XLSX & PDF');
  });
});
