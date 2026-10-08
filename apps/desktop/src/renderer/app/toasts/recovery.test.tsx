import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearToasts,
  getConnectionsModal,
  getToasts,
  resetConnectionsModal,
  resetTicketPageTabs,
  showErrorRecovery,
  useTicketPageTab,
  type RecoverableError,
  type RecoveryContext,
} from '@/shared/model';
import { RouterProvider, createRouter, routes, selectRoute, type Router } from '@/shared/routing';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { startEventHub, stopEventHub } from '../entrypoint/EventHub';
import { ToastHost } from './ToastHost';
import { runRecovery, runToastIntent, type ToastIntentContext } from './toast-intents';

vi.setConfig({ testTimeout: 30_000 });

let router: Router;
let bridge: FakeBridge;

function TabProbe() {
  return <Text testID="tab-probe">{useTicketPageTab('71273')}</Text>;
}

function renderHost() {
  render(
    <RouterProvider router={router}>
      <ToastHost />
      <TabProbe />
    </RouterProvider>,
  );
  return userEvent.setup();
}

/** Raises the error the way a feature would, then presses its recovery button. */
async function recover(error: RecoverableError, context: RecoveryContext, label: string) {
  const user = renderHost();
  act(() => {
    showErrorRecovery(error, context);
  });
  const alert = screen.getByRole('alert');
  await user.click(within(alert).getByRole('button', { name: label }));
}

describe('error recovery actions (AL-211)', () => {
  beforeEach(() => {
    router = createRouter(routes.board());
    clearToasts();
    resetConnectionsModal();
    resetTicketPageTabs();
    bridge = installFakeBridge({ 'app:copyDiagnostics': { ok: true, data: { characters: 1200 } } });
  });

  afterEach(() => {
    stopEventHub();
    act(() => clearToasts());
  });

  it('ADO_UNAUTHORIZED: Reconnect opens Connections on that organisation’s row', async () => {
    await recover({ code: 'ADO_UNAUTHORIZED', message: 'The token was refused.', details: { reason: 'reconnect', org: 'ado:contoso' } }, {}, 'Reconnect');
    expect(getConnectionsModal()).toMatchObject({ open: true, tab: 'ado', target: 'ado:contoso' });
    expect(getToasts()).toEqual([]);
  });

  it('ADO_SCOPE_MISSING: Open Connections lands on that row', async () => {
    await recover({ code: 'ADO_SCOPE_MISSING', message: 'Missing Code (read & write).' }, { connectionId: 'ado:contoso' }, 'Open Connections');
    expect(getConnectionsModal()).toMatchObject({ open: true, tab: 'ado', target: 'ado:contoso' });
  });

  it('opens Connections on the Azure DevOps tab when the organisation is unknown', async () => {
    await recover({ code: 'ADO_SCOPE_MISSING', message: 'Missing a scope.' }, {}, 'Open Connections');
    expect(getConnectionsModal()).toMatchObject({ open: true, tab: 'ado', target: null });
  });

  it('SESSION_LOST: Reconnect opens the ticket where its session shows', async () => {
    await recover({ code: 'SESSION_LOST', message: 'cc-71273 stopped responding.' }, { ticketId: '71273' }, 'Reconnect');
    expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));
    expect(screen.getByTestId('tab-probe').textContent).toBe('output');
  });

  it('BUILD_FAILED: Open build log opens the ticket on its Build log tab', async () => {
    await recover({ code: 'BUILD_FAILED', message: 'Build failed · 3 errors' }, { ticketId: '71273' }, 'Open build log');
    expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));
    expect(screen.getByTestId('tab-probe').textContent).toBe('build-log');
  });

  it('MERGE_CONFLICT: View conflicts opens the Diff tab, with the files in the toast', async () => {
    const user = renderHost();
    act(() => {
      showErrorRecovery({ code: 'MERGE_CONFLICT', message: 'Nothing was merged.', details: { files: ['Grid.razor'], fileCount: 1 } }, { ticketId: '71273' });
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Files: Grid.razor.');
    await user.click(within(alert).getByRole('button', { name: 'View conflicts' }));
    expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));
    expect(screen.getByTestId('tab-probe').textContent).toBe('diff');
  });

  it('GIT_DIRTY: Review changes opens the Diff tab on the uncommitted changes', async () => {
    await recover({ code: 'GIT_DIRTY', message: 'Uncommitted changes.', details: { files: ['a.cs'], fileCount: 1 } }, { ticketId: '71273' }, 'Review changes');
    expect(screen.getByTestId('tab-probe').textContent).toBe('diff');
  });

  it.each(['VALIDATION', 'INTERNAL'] as const)('%s: shows the details and copies diagnostics', async (code) => {
    await recover({ code, message: 'Unexpected payload from git:status' }, {}, 'Copy diagnostics');
    expect(vi.mocked(bridge.invoke)).toHaveBeenCalledWith('app:copyDiagnostics', undefined);
    await waitFor(() => expect(getToasts()).toEqual([expect.objectContaining({ title: 'Diagnostics copied', tone: 'info' })]));
  });

  it('says so when diagnostics could not be copied', async () => {
    vi.mocked(bridge.invoke).mockResolvedValue({ ok: false, code: 'INTERNAL', message: 'Clipboard busy' });
    await recover({ code: 'INTERNAL', message: 'Boom' }, {}, 'Copy diagnostics');
    await waitFor(() => expect(getToasts()).toEqual([expect.objectContaining({ title: "Couldn't copy diagnostics", body: 'Clipboard busy' })]));
  });

  it('carries out a recover intent from a main-process toast event', async () => {
    startEventHub();
    const user = renderHost();
    act(() =>
      bridge.emit('toast', {
        at: 1,
        tone: 'error',
        title: 'The build failed',
        actions: [{ label: 'Open build log', intent: { type: 'recover', code: 'BUILD_FAILED', ticketId: '71273' } }],
      }),
    );
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Open build log' }));
    expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));
    expect(screen.getByTestId('tab-probe').textContent).toBe('build-log');
  });

  it('runRecovery and runToastIntent call the environment for each kind', () => {
    const context: ToastIntentContext = {
      navigate: vi.fn(),
      openConnections: vi.fn(),
      openTicketTab: vi.fn(),
      reconnectSession: vi.fn(),
      copyDiagnostics: vi.fn(),
    };
    runRecovery({ kind: 'reconnect-session', label: 'Reconnect', ticketId: '7' }, context);
    runRecovery({ kind: 'open-connections', label: 'Reconnect', connectionId: null }, context);
    runToastIntent({ type: 'recover', code: 'GIT_DIRTY', ticketId: '7' }, context);
    runToastIntent({ type: 'recover', code: 'VALIDATION' }, context);
    expect(context.reconnectSession).toHaveBeenCalledWith('7');
    expect(context.openConnections).toHaveBeenCalledWith({ tab: 'ado' });
    expect(context.openTicketTab).toHaveBeenCalledWith('7', 'diff');
    expect(context.copyDiagnostics).toHaveBeenCalledOnce();
    expect(context.navigate).not.toHaveBeenCalled();
  });
});
