import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PeerNetworkStatus, PeersConnectionSummary } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { Button } from '@agent-lanes/ui';
import { fakeConnections, fakeTestResult, installFakeBridge, type FakeConnections } from '@/shared/testing';
import { generateTeamSecret, peerError, usePeersDraft } from '../model/use-peers-draft';
import { PeersPanel, probeSummary } from './PeersPanel';

/** AL-289: the Peers tab against the fake main process. */

/** Made up for these tests. */
const SECRET = 'office-team-secret-slice-only-0000-Pz4Q';

const savedRow: PeersConnectionSummary = {
  kind: 'peers',
  id: 'peers',
  name: 'Peers',
  port: 47811,
  peers: ['KYLE-PC', 'ROCKY-PC'],
  identity: null,
  maskedToken: `${'•'.repeat(8)}Pz4Q`,
  expiresAt: null,
  status: 'ok',
  statusMessage: null,
  needsReconnect: false,
  lastTestedAt: null,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
};

const network: PeerNetworkStatus = {
  listener: { state: 'listening', port: 47811, message: null },
  peers: [
    { address: 'KYLE-PC', state: 'online', user: 'Kyle Richards', host: 'KYLE-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', lastSeenAt: 1, rejectedFrames: 0, message: null },
    { address: 'ROCKY-PC', state: 'rejected', user: null, host: null, instance: null, lastSeenAt: null, rejectedFrames: 3, message: 'Its frames fail the signature: the team secrets differ.' },
  ],
  refusedConnections: 0,
};

function Host({ row }: { row?: PeersConnectionSummary }) {
  const draft = usePeersDraft();
  return (
    <>
      <PeersPanel draft={draft} row={row} target={null} request={0} />
      <Button label="Save" disabled={draft.status !== 'passed'} onPress={() => void draft.save().catch(() => undefined)} testID="save" />
    </>
  );
}

function setup(row?: PeersConnectionSummary): FakeConnections {
  const connections = fakeConnections(installFakeBridge({ 'peers:list': { ok: true, data: network } }), row ? [row] : []);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <Host {...(row ? { row } : {})} />
    </QueryClientProvider>,
  );
  return connections;
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const saveDisabled = () => (screen.getByTestId('save') as HTMLButtonElement).disabled;

describe('peer-network (AL-289)', () => {
  it('saves a port, a typed secret and two peers once Test passes, and shows each peer’s outcome', async () => {
    const connections = setup();
    connections.testDraft = () =>
      fakeTestResult({
        peers: [
          { address: 'KYLE-PC', outcome: 'answered', user: 'Kyle Richards', host: 'KYLE-PC', message: null },
          { address: '10.0.0.12:47812', outcome: 'unreachable', user: null, host: null, message: 'Could not connect: ECONNREFUSED' },
        ],
      });
    type('peers-port', '47900');
    fireEvent.change(screen.getByTestId('peers-secret'), { target: { value: SECRET } });
    type('peers-address-0', 'KYLE-PC');
    fireEvent.click(screen.getByTestId('peers-add'));
    type('peers-address-1', '10.0.0.12:47812');
    expect(saveDisabled()).toBe(true);

    fireEvent.click(screen.getByTestId('peers-test-connection'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    expect(screen.getByTestId('peers-test-outcome').textContent).toContain('1 answered · 1 unreachable');
    expect(screen.getByTestId('peers-probe-0').textContent).toContain('Answered');
    expect(screen.getByTestId('peers-probe-1').textContent).toContain('Unreachable');
    expect(connections.calls.find((call) => call.channel === 'connections:test')?.payload).toEqual({ draft: { kind: 'peers', port: 47900, peers: ['KYLE-PC', '10.0.0.12:47812'], teamSecret: SECRET } });

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toMatchObject({ kind: 'peers', port: 47900, teamSecret: SECRET }));
    await waitFor(() => expect((screen.getByTestId('peers-secret') as HTMLInputElement).value).toBe(''));
  });

  it('shows a generated secret to share and sends it', async () => {
    const connections = setup();
    fireEvent.click(screen.getByTestId('peers-generate'));
    const generated = screen.getByTestId('peers-generated').textContent ?? '';
    expect(generated).toMatch(/^[A-Za-z0-9_-]{32}$/);
    fireEvent.click(screen.getByTestId('peers-test-connection'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    expect(connections.calls.find((call) => call.channel === 'connections:test')?.payload).toMatchObject({ draft: { teamSecret: generated } });
  });

  it('lists the saved peers with their state in words, and changes them without retyping the secret', async () => {
    const connections = setup(savedRow);
    expect(await screen.findByText('Listening on port 47811')).toBeTruthy();
    expect(screen.getByTestId('peer-status-KYLE-PC').textContent).toContain('Online');
    expect(screen.getByTestId('peer-status-ROCKY-PC').textContent).toContain('Signature rejected');
    expect(screen.getByTestId('connection-peers').textContent).toContain(`Port 47811 · 2 peers · secret ${'•'.repeat(8)}Pz4Q`);

    fireEvent.click(screen.getByTestId('connection-peers-replace'));
    expect((screen.getByTestId('peers-address-1') as HTMLInputElement).value).toBe('ROCKY-PC');
    fireEvent.click(screen.getByTestId('peers-remove-1'));
    fireEvent.click(screen.getByTestId('peers-test-connection'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:replace')?.payload).toEqual({ id: 'peers', draft: { kind: 'peers', port: 47811, peers: ['KYLE-PC'] } }));
  });

  it('checks each peer and the port before Test', () => {
    setup();
    type('peers-port', '70000');
    fireEvent.change(screen.getByTestId('peers-secret'), { target: { value: SECRET } });
    expect((screen.getByTestId('peers-test-connection') as HTMLButtonElement).disabled).toBe(true);
    expect(peerError('http://kyle-pc', ['http://kyle-pc'])).toMatch(/computer name or IP address/);
    expect(peerError('KYLE-PC', ['KYLE-PC', 'kyle-pc'])).toBe('Listed twice.');
    expect(peerError('', [''])).toBeNull();
  });

  it('says how Test went in one line', () => {
    expect(probeSummary([])).toBe('No peers listed yet; this app will listen for them');
    expect(generateTeamSecret()).not.toBe(generateTeamSecret());
  });
});
