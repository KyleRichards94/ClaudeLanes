import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PeerLink, PeerLinkState, PeerNetworkStatus, PeersConnectionSummary } from '@agent-lanes/contracts';
import { space, tone, type Tone } from '@agent-lanes/tokens';
import { Button, Pill, Text, TextField } from '@agent-lanes/ui';
import { ConnectionForm } from '@/entities/connection';
import { usePeerNetwork } from '@/shared/api';
import type { PeersDraft } from '../model/use-peers-draft';

const LINK_VIEW: Record<PeerLinkState, { label: string; tone: Tone }> = {
  connecting: { label: 'Connecting', tone: 'neutral' },
  online: { label: 'Connected', tone: 'ok' },
  unreachable: { label: 'Unreachable', tone: 'attention' },
  rejected: { label: 'Signature rejected', tone: 'danger' },
  'other-team': { label: 'Other team', tone: 'neutral' },
};

/** What the listener is doing, in words, with the connections it refused (AL-296). */
export function listenerText(status: PeerNetworkStatus | undefined): string | null {
  const listener = status?.listener;
  if (!status || !listener || listener.state === 'off') return null;
  const refused = status.refusedConnections > 0 ? ` · ${status.refusedConnections} ${status.refusedConnections === 1 ? 'connection' : 'connections'} refused` : '';
  return listener.state === 'listening' ? `Listening on port ${listener.port ?? ''}${refused}` : (listener.message ?? 'The listener failed.');
}

function linkLine(link: PeerLink): string {
  const rejected = link.rejectedFrames > 0 ? `${link.rejectedFrames} ${link.rejectedFrames === 1 ? 'frame' : 'frames'} dropped` : null;
  return [link.address, link.user ? `${link.user}${link.host ? ` on ${link.host}` : ''}` : null, link.message, rejected].filter(Boolean).join(' · ');
}

interface PeersPanelProps {
  draft: PeersDraft;
  row: PeersConnectionSummary | undefined;
}

/** Connections › Peers (AL-289, AL-298): who this app is talking to, and the Advanced settings. No secret. */
export function PeersPanel({ draft, row }: PeersPanelProps) {
  const network = usePeerNetwork();
  const listener = listenerText(network.data);
  const { load } = draft;

  useEffect(() => {
    load(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.updatedAt]);

  return (
    <View style={styles.panel} testID="connections-peers">
      <Text variant="body">
        Agent Lanes on other computers in the office, so agents on the same Feature can see each other and talk. Apps that share an Azure DevOps project connect; nothing is sent to Azure DevOps.
      </Text>
      {listener ? (
        <Text variant="meta" testID="peers-listener">
          {listener}
        </Text>
      ) : null}
      {(network.data?.peers ?? []).map((link) => (
        <View key={link.address} style={styles.peer} testID={`peer-status-${link.address}`}>
          <Pill label={LINK_VIEW[link.state].label} tone={LINK_VIEW[link.state].tone} dot />
          <Text variant="meta" selectable style={styles.grow}>
            {linkLine(link)}
          </Text>
        </View>
      ))}

      <ConnectionForm title="Advanced" testID="peers-draft">
        <View style={styles.pair}>
          <TextField
            label="Port"
            help="Other apps reach this one on it. Windows asks once to allow the app on private networks."
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
            help="UDP. Every app in the office uses the same one."
            value={draft.beaconPort}
            onChangeText={draft.setBeaconPort}
            error={draft.beaconPortError}
            inputMode="numeric"
            autoComplete="off"
            style={styles.port}
            testID="peers-beacon-port"
          />
        </View>
        <View style={styles.list}>
          <Text variant="title">Addresses</Text>
          <Text variant="meta">Only for an app on another subnet that the beacon can't reach. Add this computer on that one too.</Text>
          {draft.addresses.map((address, index) => (
            <View key={index} style={styles.peerRow}>
              <TextField
                aria-label={`Address ${index + 1}`}
                placeholder="KYLE-PC or 10.0.0.12:47812"
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
  list: {
    gap: space.sm,
  },
  peerRow: {
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
