import { defaultStageGates, type AgentSessionStatus } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { clearLaunchedTicket, clearToasts, getToasts } from '@/shared/model';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import type { NewTicketRequest } from '../model/form';
import { NO_REPO_MESSAGE, toLaunchRequest, useLaunchTicket } from './launch';

const request: NewTicketRequest = {
  workItem: { id: 71273, title: 'Cutover frmJobControl to Blazor', type: 'User Story', state: 'Active' },
  description: 'Cut it over',
  skills: ['code-review'],
  model: 'opus',
  effort: 'xhigh',
  gates: defaultStageGates(),
  worktreeName: null,
  repo: 'C:\\src\\onsite-companion',
};

function setUp(reply: unknown) {
  const bridge = installFakeBridge({ 'tickets:launch': reply });
  const store = createAgentTicketStore();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useLaunchTicket(store), { wrapper });
  return { bridge, store, launch: result.current };
}

afterEach(() => {
  clearToasts();
  clearLaunchedTicket();
});

describe('Launch (AL-165)', () => {
  it('sends the work item id and title only, and refuses without a repo', () => {
    expect(toLaunchRequest(request)).toEqual({
      repo: 'C:\\src\\onsite-companion',
      workItem: { id: 71273, title: 'Cutover frmJobControl to Blazor' },
      description: 'Cut it over',
      skills: ['code-review'],
      model: 'opus',
      effort: 'xhigh',
      gates: defaultStageGates(),
      worktreeName: null,
    });
    expect(toLaunchRequest({ ...request, repo: null })).toBeNull();
  });

  it('puts the new card on the board in Planning once main started it', async () => {
    const record = fakeTicketRecord({ stage: 'planning' });
    const status: AgentSessionStatus = { ticketId: '71273', state: 'running', sessionId: null, message: null };
    const { bridge, store, launch } = setUp({ ok: true, data: { record, status } });

    await expect(launch(request)).resolves.toEqual({ record, status });
    expect(bridge.invoke).toHaveBeenCalledWith('tickets:launch', toLaunchRequest(request));
    expect(store.getState().byLane.planning).toEqual(['71273']);
  });

  it('rejects with the reason; ADO and internal failures also raise their recovery toast', async () => {
    const refused = setUp({ ok: false, code: 'VALIDATION', message: 'A branch named "main" already exists.', details: { reason: 'branch-taken' } });
    await expect(refused.launch(request)).rejects.toThrow('A branch named "main" already exists.');
    expect(getToasts()).toEqual([]);
    expect(refused.store.getState().byId.size).toBe(0);

    const offline = setUp({ ok: false, code: 'ADO_UNAUTHORIZED', message: 'Reconnect contoso.', details: { org: 'ado:contoso' } });
    await expect(offline.launch(request)).rejects.toThrow('Reconnect contoso.');
    expect(getToasts()).toMatchObject([{ tone: 'error', actions: [{ label: 'Reconnect', intent: { type: 'recover', code: 'ADO_UNAUTHORIZED', connectionId: 'ado:contoso' } }] }]);

    const noRepo = setUp({ ok: true });
    await expect(noRepo.launch({ ...request, repo: null })).rejects.toThrow(NO_REPO_MESSAGE);
    expect(noRepo.bridge.invoke).not.toHaveBeenCalled();
  });
});
