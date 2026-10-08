import { LAUNCH_UNDO_WINDOW_MS, type LaunchFromAdoResponse } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { clearToasts, getToasts } from '@/shared/model';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { UNDO_LABEL, launchToastId, showLaunchToast } from './undo';

const launched: LaunchFromAdoResponse = {
  ticketId: '71318',
  record: fakeTicketRecord({ id: '71318', stage: 'planning' }),
  status: { ticketId: '71318', state: 'running', sessionId: null, message: null },
  adoChange: { workItemId: 71318, previousAssignee: null, previousState: 'Failed UAT', state: 'Active' },
  undoId: 'u'.repeat(48),
  summary: '#71318 assigned to you and moved to In Progress · agent started in Planning',
};

const undone = { ok: true, data: { ticketId: '71318', worktreeRemoved: true, leftovers: [], adoRestored: true, summary: '#71318 is back in Failed UAT, unassigned · the worktree and agent are gone' } };

function setUp(reply: unknown = undone) {
  const bridge = installFakeBridge({ 'agent:undoLaunch': reply });
  const store = createAgentTicketStore();
  store.upsert(launched.record);
  const refresh = vi.fn();
  const stop = showLaunchToast(launched, { store, refresh });
  const toastNow = () => getToasts().find((entry) => entry.id === launchToastId('71318'));
  const pressUndo = () => {
    const action = toastNow()?.actions.find((candidate) => candidate.label === UNDO_LABEL);
    if (!action || !('onPress' in action)) throw new Error('no Undo');
    action.onPress();
  };
  return { bridge, store, refresh, stop, toastNow, pressUndo };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

describe('the launch toast and Undo (AL-237)', () => {
  it('says what changed and offers Undo for the full 10 s, then not', () => {
    const { toastNow, stop } = setUp();
    expect(toastNow()).toMatchObject({ tone: 'success', title: 'Agent started in Planning', body: launched.summary, actions: [{ label: 'Undo' }] });

    vi.advanceTimersByTime(LAUNCH_UNDO_WINDOW_MS - 1);
    expect(toastNow()?.actions.map((action) => action.label)).toEqual(['Undo']);

    vi.advanceTimersByTime(1);
    expect(toastNow()).toMatchObject({ tone: 'info', title: 'Agent started in Planning', actions: [] });
    stop();
  });

  it('Undo asks main to put everything back, then takes the card off the board', async () => {
    const { bridge, store, refresh, toastNow, pressUndo } = setUp();
    vi.advanceTimersByTime(9_000);
    pressUndo();
    await vi.waitFor(() => expect(toastNow()).toMatchObject({ tone: 'info', title: 'Launch undone', body: undone.data.summary }));
    expect(bridge.invoke).toHaveBeenCalledWith('agent:undoLaunch', { undoId: launched.undoId });
    expect(store.getState().byId.has('71318')).toBe(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("drops Undo when the agent's first turn ends", () => {
    const { bridge, toastNow, stop } = setUp();
    bridge.emit('agent:status', { ticketId: '71318', at: 1, state: 'idle', sessionId: 's1', message: null });
    expect(toastNow()?.actions).toEqual([]);
    stop();
  });

  it('a refused Undo says what to revert by hand and keeps the card', async () => {
    const message = 'The agent already pushed its branch. To revert by hand: delete the branch on origin, …';
    const { store, toastNow, pressUndo } = setUp({ ok: false, code: 'VALIDATION', message, details: { reason: 'pushed' } });
    pressUndo();
    await vi.waitFor(() => expect(toastNow()).toMatchObject({ tone: 'warning', title: 'Undo is no longer available', body: message }));
    expect(store.getState().byId.has('71318')).toBe(true);
  });
});
