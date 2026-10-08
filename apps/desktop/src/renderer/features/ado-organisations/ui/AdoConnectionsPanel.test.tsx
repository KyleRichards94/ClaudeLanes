import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdoConnectionSummary } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { Button } from '@agent-lanes/ui';
import { fakeAdoRow, fakeConnections, fakeTestResult, installFakeBridge, type FakeConnections } from '@/shared/testing';
import { useAdoDraft } from '../model/use-ado-draft';
import { AdoConnectionsPanel, PAT_HELP } from './AdoConnectionsPanel';

/**
 * AL-220: the Azure DevOps organisations slice end to end in the renderer: the panel, its draft and
 * the shared connection mutations, against the fake main process (`fakeConnections`). The Connections
 * modal's own test covers the tabs and footer; this one covers what the slice decides itself.
 */

/** Made up for these tests; shaped like a PAT, valid nowhere. */
const FAKE_PAT = 'fakepat0000slice1111ado2222only3333here4444zz9K';

/** The panel with the modal's Save, which only the passed draft enables. */
function Host({ rows }: { rows: readonly AdoConnectionSummary[] }) {
  const draft = useAdoDraft();
  return (
    <>
      <AdoConnectionsPanel draft={draft} rows={rows} target={null} request={0} now={new Date('2026-10-08T00:00:00Z')} />
      <Button label="Save" disabled={draft.status !== 'passed'} onPress={() => void draft.save().catch(() => undefined)} testID="save" />
    </>
  );
}

function setup(rows: AdoConnectionSummary[] = []): FakeConnections {
  const connections = fakeConnections(installFakeBridge(), rows);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <Host rows={rows} />
    </QueryClientProvider>,
  );
  return connections;
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const saveDisabled = () => (screen.getByTestId('save') as HTMLButtonElement).disabled;

describe('ado-organisations (AL-046, AL-220)', () => {
  it('tests the typed organisation, then refuses a project the token cannot see and an expiry that is not a date', async () => {
    const connections = setup();
    expect(screen.getByText(PAT_HELP)).toBeTruthy();
    type('ado-org-url', 'https://dev.azure.com/Hicora');
    type('ado-pat', FAKE_PAT);
    fireEvent.click(screen.getByTestId('ado-test-connection'));
    expect(await screen.findByText('Connection works · signed in as Kyle Richards')).toBeTruthy();
    expect(connections.calls.find((call) => call.channel === 'connections:test')?.payload).toEqual({
      draft: { kind: 'ado', orgUrl: 'https://dev.azure.com/Hicora', pat: FAKE_PAT, defaultProject: null, expiresAt: null },
    });
    expect(saveDisabled()).toBe(false);

    type('ado-default-project', 'Payroll');
    expect(await screen.findByText('The token can\'t see a project called "Payroll".')).toBeTruthy();
    expect(saveDisabled()).toBe(true);
    type('ado-default-project', 'Hicora');
    type('ado-expires', '12/01/2027');
    expect(screen.getByText('Enter a date like 2027-01-12, or leave it empty.')).toBeTruthy();
    expect(saveDisabled()).toBe(true);
    type('ado-expires', '2027-01-12');
    expect(saveDisabled()).toBe(false);

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() =>
      expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toEqual({
        kind: 'ado',
        orgUrl: 'https://dev.azure.com/Hicora',
        pat: FAKE_PAT,
        defaultProject: 'Hicora',
        expiresAt: '2027-01-12',
      }),
    );
    // The draft row is empty again and gave the token up.
    await waitFor(() => expect((screen.getByTestId('ado-org-url') as HTMLInputElement).value).toBe(''));
    expect((screen.getByTestId('ado-pat') as HTMLInputElement).value).toBe('');
  });

  it('says why a save failed and asks for the token again', async () => {
    const connections = setup();
    const bridge = window.agentLanes;
    const invoke = bridge.invoke;
    bridge.invoke = async (channel, payload) =>
      channel === 'connections:save' ? { ok: false, code: 'VALIDATION', message: 'That organisation is already connected.' } : invoke(channel, payload);
    type('ado-org-url', 'https://dev.azure.com/CompanionSystems');
    type('ado-pat', FAKE_PAT);
    fireEvent.click(screen.getByTestId('ado-test-connection'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    expect((await screen.findByRole('alert')).textContent).toBe('That organisation is already connected. Enter the token again to retry.');
    expect(saveDisabled()).toBe(true);
    expect(connections.rows).toEqual([]);
  });

  it('tests a saved organisation again by its id, and Cancel replace goes back to adding one', async () => {
    const connections = setup([fakeAdoRow()]);
    fireEvent.click(screen.getByTestId('connection-ado:companionsystems-test'));
    await waitFor(() => expect(connections.calls).toContainEqual({ channel: 'connections:test', payload: { id: 'ado:companionsystems' } }));

    fireEvent.click(screen.getByTestId('connection-ado:companionsystems-replace'));
    expect(screen.getByRole('group', { name: 'Replace the token for CompanionSystems' })).toBeTruthy();
    expect((screen.getByTestId('ado-org-url') as HTMLInputElement).value).toBe('https://dev.azure.com/CompanionSystems');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replace' }));
    expect(screen.getByRole('group', { name: 'Add another organisation' })).toBeTruthy();
    expect((screen.getByTestId('ado-org-url') as HTMLInputElement).value).toBe('');
  });

  it('shows a failed test in words and keeps Save off', async () => {
    const connections = setup();
    connections.testDraft = () => fakeTestResult({ status: 'error', message: 'Azure DevOps refused this token.' });
    type('ado-org-url', 'https://dev.azure.com/Hicora');
    type('ado-pat', FAKE_PAT);
    fireEvent.click(screen.getByTestId('ado-test-connection'));
    expect(await within(screen.getByTestId('ado-test-outcome')).findByText('Azure DevOps refused this token.')).toBeTruthy();
    expect(saveDisabled()).toBe(true);
  });
});
