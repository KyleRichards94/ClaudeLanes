import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { clearLaunchedTicket, clearToasts, getToasts } from '@/shared/model';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { useLaunchFromAdo, type AdoDrop } from './launch';

const drop: AdoDrop = { source: { kind: 'board-item', id: 71318, team: 'OSC Developers', sprint: 'OnSite Companion\\Sprint 42', column: 'Failed' }, lane: 'planning', repo: 'C:\\src\\onsite-companion' };

function setUp(reply: unknown) {
  const bridge = installFakeBridge({ 'agent:launchFromAdo': reply, 'repos:add': { ok: true, data: { outcome: 'cancelled', repos: [] } } });
  const store = createAgentTicketStore();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useLaunchFromAdo(store), { wrapper });
  return { bridge, store, invalidate, launch: result.current };
}

afterEach(() => {
  clearToasts();
  clearLaunchedTicket();
});

describe('launch from the team board (AL-236)', () => {
  it('puts the card in its lane, says what changed and refreshes the team board', async () => {
    const record = fakeTicketRecord({ id: '71318', stage: 'planning' });
    const data = {
      ticketId: '71318',
      record,
      status: { ticketId: '71318', state: 'running', sessionId: null, message: null },
      adoChange: { workItemId: 71318, previousAssignee: null, previousState: 'Failed UAT', state: 'Active' },
      undoId: 'a'.repeat(48),
      summary: '#71318 assigned to you and moved to In Progress · agent started in Planning',
    };
    const { bridge, store, invalidate, launch } = setUp({ ok: true, data });

    await expect(launch(drop)).resolves.toEqual(data);
    expect(bridge.invoke).toHaveBeenCalledWith('agent:launchFromAdo', drop);
    expect(store.getState().byLane.planning).toEqual(['71318']);
    expect(getToasts()).toMatchObject([{ tone: 'success', body: '#71318 assigned to you and moved to In Progress · agent started in Planning' }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ado', 'teamBoard'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ado', 'activePrs'] });
  });

  it('a refused drop says why; an unregistered repo offers "Add repo"; a missing scope opens Connections', async () => {
    const moved = setUp({ ok: false, code: 'VALIDATION', message: 'Moved to Testing — refreshed', details: { reason: 'moved', column: 'Testing' } });
    await expect(moved.launch(drop)).resolves.toBeNull();
    expect(getToasts()).toMatchObject([{ tone: 'warning', body: 'Moved to Testing — refreshed', actions: [] }]);
    expect(moved.invalidate).toHaveBeenCalledWith({ queryKey: ['ado', 'teamBoard'] });
    clearToasts();

    const addRepo = setUp({ ok: false, code: 'VALIDATION', message: "!10590's repository osc-mobile isn't registered in Agent Lanes. Add repo to review it.", details: { reason: 'add-repo' } });
    await addRepo.launch({ source: { kind: 'pull-request', id: 10590 }, lane: 'code-review' });
    const [toast] = getToasts();
    expect(toast?.actions.map((action) => action.label)).toEqual(['Add repo']);
    const action = toast?.actions[0];
    if (action && 'onPress' in action) action.onPress();
    await vi.waitFor(() => expect(addRepo.bridge.invoke).toHaveBeenCalledWith('repos:add', undefined));
    clearToasts();

    const scope = setUp({ ok: false, code: 'ADO_SCOPE_MISSING', message: 'The Azure DevOps token for CompanionSystems is missing the Work Items (read & write) scope this drop needs.', details: { org: 'ado:companionsystems', scope: 'work-items' } });
    await scope.launch(drop);
    expect(getToasts()).toMatchObject([{ tone: 'error', actions: [{ label: 'Open Connections', intent: { type: 'recover', code: 'ADO_SCOPE_MISSING', connectionId: 'ado:companionsystems' } }] }]);
  });
});
