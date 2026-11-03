import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PeerLink, PeerLinkState, PeerNetworkStatus, PeersConnectionSummary } from '@agent-lanes/contracts';
import { space, tone, type Tone } from '@agent-lanes/tokens';
import { Button, Pill, Text, TextField } from '@agent-lanes/ui';
import { ConnectionForm } from '@/entities/connection';
import { clock } from '@/entities/peer';
import { useFindPeers, usePeerNetwork } from '@/shared/api';
import type { PeersDraft } from '../model/use-peers-draft';

const LINK_VIEW: Record<PeerLinkState, { label: string; tone: Tone }> = {
  connecting: { label: 'Connecting', tone: 'neutral' },
  online: { label: 'Connected', tone: 'ok' },
  unreachable: { label: 'Unreachable', tone: 'attention' },
  rejected: { label: 'Signature rejected', tone: 'danger' },
  'other-team': { label: 'Other team', tone: 'neutral' },
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What the listener is doing, in words, with the connections it refused (AL-296). */
export function listenerText(status: PeerNetworkStatus | undefined): string | null {
  const listener = status?.listener;
  if (!status || !listener || listener.state === 'off') return null;
  const refused = status.refusedConnections > 0 ? ` · ${plural(status.refusedConnections, 'connection')} refused` : '';
  return listener.state === 'listening' ? `Listening on port ${listener.port ?? ''}${refused}` : (listener.message ?? 'The listener failed.');
}

/** What the beacon is doing, with the beacons it ignored (another team, outside the office network). */
export function beaconText(status: PeerNetworkStatus | undefined): string | null {
  const beacon = status?.beacon;
  if (!status || !beacon || beacon.state === 'off') return null;
  const ignored = status.ignoredBeacons > 0 ? ` · ${plural(status.ignoredBeacons, 'beacon')} ignored` : '';
  return beacon.state === 'listening' ? `Beacon on UDP port ${beacon.port ?? ''}${ignored}` : (beacon.message ?? 'The beacon failed.');
}

/** `Kyle Richards on KYLE-PC · 10.0.0.12:47811 · seen 14:02 · Waiting for it to connect.` */
export function peerLine(link: PeerLink): string {
  const who = link.user ? `${link.user}${link.host ? ` on ${link.host}` : ''}` : null;
  const dropped = link.rejectedFrames > 0 ? `${plural(link.rejectedFrames, 'frame')} dropped` : null;
  return [who, link.address, link.lastSeenAt ? `seen ${clock(link.lastSeenAt)}` : null, link.message, dropped].filter(Boolean).join(' · ');
}

interface PeersPanelProps {
  draft: PeersDraft;
  row: PeersConnectionSummary | undefined;
}

/**
 * Connections › Peers (AL-298, PL§2): a status page, not a form. Who this app is, its listener and
 * beacon, the peers it has found or been given, and Advanced for the ports and the addresses of apps
 * the beacon can't reach. There is no secret: apps in the same Azure DevOps project connect.
 */
export function PeersPanel({ draft, row }: PeersPanelProps) {
  const network = usePeerNetwork();
  const findPeers = useFindPeers();
  const status = network.data;
  const off = status?.listener.state === 'off';
  const listener = listenerText(status);
  const beacon = beaconText(status);
  const peers = status?.peers ?? [];
  const { load } = draft;

  useEffect(() => {
    load(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.updatedAt]);

  return (
    <View style={styles.panel} testID="connections-peers">
      <Text variant="body">
        Agent Lanes on other computers in the office find each other, so agents on the same Feature can see each other and talk. Apps in the same Azure DevOps project connect; there's nothing to type,
        and nothing is sent to Azure DevOps.
      </Text>

      <View style={styles.section} testID="peers-this-computer">
        <Text variant="title">This computer</Text>
        {status ? (
          <Text variant="meta" selectable testID="peers-identity">
            {`${status.identity.user} on ${status.identity.host}`}
          </Text>
        ) : null}
        {off ? (
          <Text variant="meta" testID="peers-off">
            Peer lanes is off. It starts once an Azure DevOps connection has a default project, or a lane from one is running.
          </Text>
        ) : (
          <>
            {listener ? (
              <Text variant="meta" color={status?.listener.state === 'failed' ? tone.danger.text : undefined} testID="peers-listener">
                {listener}
              </Text>
            ) : null}
            {beacon ? (
              <Text variant="meta" color={status?.beacon.state === 'failed' ? tone.attention.text : undefined} testID="peers-beacon">
                {beacon}
              </Text>
            ) : null}
            {status ? (
              <Text variant="meta" testID="peers-teams">
                {`Team: ${plural(status.teams, 'Azure DevOps project')}`}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.heading}>
          <Text variant="title" style={styles.grow}>
            Peers
          </Text>
          <Button label="Find peers" variant="secondary" size="sm" loading={findPeers.isPending} disabled={off} onPress={() => findPeers.mutate()} testID="peers-find" />
        </View>
        {peers.length === 0 && !off ? (
          <Text variant="meta" testID="peers-none">
            None found yet. If another Agent Lanes is running, check both computers let it through Windows Firewall on private networks, or add its address under Advanced.
          </Text>
        ) : null}
        {peers.map((link) => (
          <View key={link.address} style={styles.peer} testID={`peer-status-${link.address}`}>
            <Pill label={LINK_VIEW[link.state].label} tone={LINK_VIEW[link.state].tone} dot />
            <Text variant="meta" selectable style={styles.grow}>
              {peerLine(link)}
            </Text>
          </View>
        ))}
      </View>

      <ConnectionForm title="Advanced" testID="peers-draft">
        <View style={styles.pair}>
          <TextField
            label="Port"
            help="Other apps reach this one on it. Windows asks once to allow Agent Lanes on private networks."
            value={draft.port}
            onChangeText={draft.setPort}
            error={draft.portError}
            inputMode="numeric"
            autoComplete="off"
            style={styles.port}
            testID="peers-port"
          />
          <TextField
            label="Beacon port"
            help="UDP. The same on every computer in the office."
            value={draft.beaconPort}
            onChangeText={draft.setBeaconPort}
            error={draft.beaconPortError}
            inputMode="numeric"
            autoComplete="off"
            style={styles.port}
            testID="peers-beacon-port"
          />
        </View>
        <View style={styles.section}>
          <Text variant="title">Addresses</Text>
          <Text variant="meta">Only for an app on another subnet the beacon can't reach. Add this computer on that one too.</Text>
          {draft.addresses.map((address, index) => (
            <View key={index} style={styles.addressRow}>
              <TextField
                aria-label={`Address ${index + 1}`}
                placeholder="KYLE-PC or 10.0.1.12:47812"
                value={address}
                onChangeText={(value) => draft.setAddress(index, value)}
                error={draft.addressErrors[index] ?? null}
                autoComplete="off"
                style={styles.grow}
                testID={`peers-address-${index}`}
              />
              <Button label="Remove" variant="secondary" size="sm" onPress={() => draft.removeAddress(index)} testID={`peers-remove-${index}`} />
            </View>
          ))}
          <View style={styles.buttons}>
            <Button label="Add address" variant="secondary" size="sm" onPress={draft.addAddress} testID="peers-add" />
          </View>
        </View>
        {draft.saveError ? (
          <Text variant="meta" color={tone.danger.text} role="alert">
            {draft.saveError}
          </Text>
        ) : null}
      </ConnectionForm>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.lg,
  },
  section: {
    gap: space.sm,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  pair: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  port: {
    width: 160,
  },
  grow: {
    flex: 1,
    flexShrink: 1,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  peer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  buttons: {
    flexDirection: 'row',
  },
});
