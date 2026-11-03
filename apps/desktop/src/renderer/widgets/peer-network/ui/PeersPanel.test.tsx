import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PeerNetworkStatus, PeersConnectionSummary } from '@agent-lanes/contracts';
import { peerNetworkFixture } from '@agent-lanes/contracts/testing';
import { describe, expect, it } from 'vitest';
import { Button } from '@agent-lanes/ui';
import { fakeConnections, installFakeBridge, type FakeConnections } from '@/shared/testing';
import { addressError, usePeersDraft } from '../model/use-peers-draft';
import { PeersPanel, beaconText, listenerText, peerLine } from './PeersPanel';

/** AL-298: the Peers tab against the fake main process. */

const savedRow: PeersConnectionSummary = {
  kind: 'peers',
  id: 'peers',
  name: 'Peers',
  port: 47811,
  beaconPort: 47810,
  addresses: ['10.0.1.30'],
  identity: null,
  maskedToken: null,
  expiresAt: null,
  status: 'untested',
  statusMessage: null,
  needsReconnect: false,
  lastTestedAt: null,
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
};

const SEEN = new Date(2026, 9, 30, 14, 2).getTime();

const network: PeerNetworkStatus = peerNetworkFixture({
  peers: [
    { address: '10.0.0.12:47811', source: 'found', state: 'online', user: 'Kyle Richards', host: 'KYLE-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', lastSeenAt: SEEN, rejectedFrames: 0, message: null },
    { address: '10.0.0.40:47811', source: 'found', state: 'other-team', user: 'Sam Lee', host: 'SAM-PC', instance: '2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', lastSeenAt: SEEN, rejectedFrames: 0, message: 'It shares no Azure DevOps project with this app.' },
    { address: '10.0.1.30', source: 'listed', state: 'unreachable', user: null, host: null, instance: null, lastSeenAt: null, rejectedFrames: 0, message: 'Could not connect: ECONNREFUSED' },
  ],
  ignoredBeacons: 4,
});

function Host({ row }: { row?: PeersConnectionSummary }) {
  const draft = usePeersDraft();
  return (
    <>
      <PeersPanel draft={draft} row={row} />
      <Button label="Save" disabled={draft.status !== 'passed'} onPress={() => void draft.save().catch(() => undefined)} testID="save" />
    </>
  );
}

function setup(row?: PeersConnectionSummary, status: PeerNetworkStatus = network): FakeConnections {
  const found: PeerNetworkStatus = { ...status, peers: status.peers.map((peer) => (peer.state === 'unreachable' ? { ...peer, state: 'online' } : peer)) };
  const connections = fakeConnections(installFakeBridge({ 'peers:list': { ok: true, data: status }, 'peers:find': { ok: true, data: found } }), row ? [row] : []);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <Host {...(row ? { row } : {})} />
    </QueryClientProvider>,
  );
  return connections;
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const saveDisabled = () => (screen.getByTestId('save') as HTMLButtonElement).disabled;

describe('peer-network (AL-298)', () => {
  it('shows who this app is, its listener and beacon, and the peers it found with their state in words; no secret field', async () => {
    setup(savedRow);
    expect(await screen.findByText('Mitch Healy on MITCH-PC')).toBeTruthy();
    expect(screen.getByTestId('peers-listener').textContent).toBe('Listening on port 47811');
    expect(screen.getByTestId('peers-beacon').textContent).toBe('Beacon on UDP port 47810 · 4 beacons ignored');
    expect(screen.getByTestId('peers-teams').textContent).toBe('Team: 1 Azure DevOps project');
    expect(screen.getByTestId('peer-status-10.0.0.12:47811').textContent).toContain('Connected');
    expect(screen.getByTestId('peer-status-10.0.0.12:47811').textContent).toContain('Kyle Richards on KYLE-PC · 10.0.0.12:47811 · seen 14:02');
    expect(screen.getByTestId('peer-status-10.0.0.40:47811').textContent).toContain('Other team');
    expect(screen.getByTestId('peer-status-10.0.1.30').textContent).toContain('Unreachable');
    expect(screen.queryByTestId('peers-secret')).toBeNull();
    expect(screen.queryByText(/secret/i)).toBeNull();
  });

  it('Find peers asks main to look again and shows what it found', async () => {
    setup(savedRow);
    expect((await screen.findByTestId('peer-status-10.0.1.30')).textContent).toContain('Unreachable');
    fireEvent.click(screen.getByTestId('peers-find'));
    await waitFor(() => expect(screen.getByTestId('peer-status-10.0.1.30').textContent).toContain('Connected'));
  });

  it('says when peer lanes is off, and points at the firewall and Advanced when nobody is found', async () => {
    setup(undefined, peerNetworkFixture({ listener: { state: 'off', port: null, message: null }, beacon: { state: 'off', port: null, message: null }, teams: 0 }));
    expect((await screen.findByTestId('peers-off')).textContent).toContain('default project');
    expect((screen.getByTestId('peers-find') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves changed ports and an address under Advanced without a test', async () => {
    const connections = setup(undefined, peerNetworkFixture());
    expect(await screen.findByTestId('peers-none')).toBeTruthy();
    expect(screen.getByTestId('peers-none').textContent).toContain('Windows Firewall');
    expect(saveDisabled()).toBe(true);
    type('peers-port', '47821');
    type('peers-beacon-port', '47820');
    type('peers-address-0', '10.0.1.12:47812');
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toEqual({ kind: 'peers', port: 47821, beaconPort: 47820, addresses: ['10.0.1.12:47812'] }));
    expect(connections.calls.some((call) => call.channel === 'connections:test')).toBe(false);
  });

  it('changes the saved addresses with Replace', async () => {
    const connections = setup(savedRow);
    await waitFor(() => expect((screen.getByTestId('peers-address-0') as HTMLInputElement).value).toBe('10.0.1.30'));
    fireEvent.click(screen.getByTestId('peers-remove-0'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:replace')?.payload).toEqual({ id: 'peers', draft: { kind: 'peers', port: 47811, beaconPort: 47810, addresses: [] } }));
  });

  it('checks each address and both ports before Save', () => {
    setup();
    type('peers-beacon-port', '70000');
    expect(saveDisabled()).toBe(true);
    expect(addressError('http://kyle-pc', ['http://kyle-pc'])).toMatch(/computer name or IP address/);
    expect(addressError('KYLE-PC', ['KYLE-PC', 'kyle-pc'])).toBe('Listed twice.');
    expect(addressError('', [''])).toBeNull();
  });

  it('puts the counters and the state in words (AL-296)', () => {
    expect(listenerText({ ...network, refusedConnections: 2 })).toBe('Listening on port 47811 · 2 connections refused');
    expect(listenerText({ ...network, listener: { state: 'off', port: null, message: null } })).toBeNull();
    expect(beaconText({ ...network, beacon: { state: 'failed', port: 47810, message: 'UDP port 47810 is in use.' } })).toBe('UDP port 47810 is in use.');
    expect(peerLine({ address: '10.0.1.30', source: 'listed', state: 'rejected', user: null, host: null, instance: null, lastSeenAt: null, rejectedFrames: 1, message: 'Its frames fail the signature.' })).toBe(
      '10.0.1.30 · Its frames fail the signature. · 1 frame dropped',
    );
  });
});
