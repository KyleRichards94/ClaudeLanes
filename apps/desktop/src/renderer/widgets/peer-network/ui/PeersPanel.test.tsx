import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PeerNetworkStatus, PeersConnectionSummary } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { Button } from '@agent-lanes/ui';
import { fakeConnections, installFakeBridge, type FakeConnections } from '@/shared/testing';
import { addressError, usePeersDraft } from '../model/use-peers-draft';
import { PeersPanel, listenerText } from './PeersPanel';

/** AL-298: the Peers tab against the fake main process. */

const savedRow: PeersConnectionSummary = {
  kind: 'peers',
  id: 'peers',
  name: 'Peers',
  port: 47811,
  beaconPort: 47810,
  addresses: ['KYLE-PC', 'ROCKY-PC'],
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

const network: PeerNetworkStatus = {
  listener: { state: 'listening', port: 47811, message: null },
  peers: [
    { address: 'KYLE-PC', state: 'online', user: 'Kyle Richards', host: 'KYLE-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', lastSeenAt: 1, rejectedFrames: 0, message: null },
    { address: 'ROCKY-PC', state: 'other-team', user: null, host: null, instance: null, lastSeenAt: null, rejectedFrames: 3, message: 'It shares no Azure DevOps project with this app.' },
  ],
  teams: 1,
  refusedConnections: 0,
};

function Host({ row }: { row?: PeersConnectionSummary }) {
  const draft = usePeersDraft();
  return (
    <>
      <PeersPanel draft={draft} row={row} />
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

describe('peer-network (AL-298)', () => {
  it('has no secret field, and saves changed ports and an address without a test', async () => {
    const connections = setup();
    expect(screen.queryByTestId('peers-secret')).toBeNull();
    expect(saveDisabled()).toBe(true);
    type('peers-port', '47821');
    type('peers-beacon-port', '47820');
    type('peers-address-0', '10.0.1.12:47812');
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toEqual({ kind: 'peers', port: 47821, beaconPort: 47820, addresses: ['10.0.1.12:47812'] }));
    expect(connections.calls.some((call) => call.channel === 'connections:test')).toBe(false);
  });

  it('lists the peers with their state in words, and changes the saved addresses', async () => {
    const connections = setup(savedRow);
    expect(await screen.findByText('Listening on port 47811')).toBeTruthy();
    expect(screen.getByTestId('peer-status-KYLE-PC').textContent).toContain('Connected');
    expect(screen.getByTestId('peer-status-ROCKY-PC').textContent).toContain('Other team');
    expect(screen.getByTestId('peer-status-ROCKY-PC').textContent).toContain('3 frames dropped');

    expect((screen.getByTestId('peers-address-1') as HTMLInputElement).value).toBe('ROCKY-PC');
    fireEvent.click(screen.getByTestId('peers-remove-1'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:replace')?.payload).toEqual({ id: 'peers', draft: { kind: 'peers', port: 47811, beaconPort: 47810, addresses: ['KYLE-PC'] } }));
  });

  it('checks each address and both ports before Save', () => {
    setup();
    type('peers-port', '70000');
    expect(saveDisabled()).toBe(true);
    expect(addressError('http://kyle-pc', ['http://kyle-pc'])).toMatch(/computer name or IP address/);
    expect(addressError('KYLE-PC', ['KYLE-PC', 'kyle-pc'])).toBe('Listed twice.');
    expect(addressError('', [''])).toBeNull();
  });

  it('counts refused connections on the listener line (AL-296)', () => {
    expect(listenerText({ ...network, refusedConnections: 2 })).toBe('Listening on port 47811 · 2 connections refused');
    expect(listenerText({ ...network, listener: { state: 'off', port: null, message: null } })).toBeNull();
  });
});
