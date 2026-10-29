import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ConnectionId, PeerLink, PeerLinkState, PeerNetworkStatus, PeerProbe, PeersConnectionSummary } from '@agent-lanes/contracts';
import { space, tone, type Tone } from '@agent-lanes/tokens';
import { Button, Pill, Text, TextField } from '@agent-lanes/ui';
import { ConnectionForm, ConnectionRow, RemoveConnectionButton, TestOutcome, connectionStatusView } from '@/entities/connection';
import { usePeerNetwork, useRemoveConnection, useTestConnection } from '@/shared/api';
import type { PeersDraft } from '../model/use-peers-draft';

const LINK_VIEW: Record<PeerLinkState, { label: string; tone: Tone }> = {
  connecting: { label: 'Connecting', tone: 'neutral' },
  online: { label: 'Online', tone: 'ok' },
  unreachable: { label: 'Unreachable', tone: 'attention' },
  rejected: { label: 'Signature rejected', tone: 'danger' },
};

const PROBE_VIEW: Record<PeerProbe['outcome'], { label: string; tone: Tone }> = {
  answered: { label: 'Answered', tone: 'ok' },
  unreachable: { label: 'Unreachable', tone: 'attention' },
  rejected: { label: 'Signature rejected', tone: 'danger' },
};

/** The saved row's detail line: `Port 47811 · 3 peers · secret ••••••••Pz4Q`. */
export function peersRowDetails(row: PeersConnectionSummary): string {
  return [`Port ${row.port}`, `${row.peers.length} ${row.peers.length === 1 ? 'peer' : 'peers'}`, row.maskedToken ? `secret ${row.maskedToken}` : null].filter(Boolean).join(' · ');
}

/** What the listener is doing, in words, with the connections it refused (AL-296). */
export function listenerText(status: PeerNetworkStatus | undefined): string | null {
  const listener = status?.listener;
  if (!status || !listener || listener.state === 'off') return null;
  const refused = status.refusedConnections > 0 ? ` · ${status.refusedConnections} ${status.refusedConnections === 1 ? 'connection' : 'connections'} refused` : '';
  return listener.state === 'listening' ? `Listening on port ${listener.port ?? ''}${refused}` : (listener.message ?? 'The listener failed.');
}

function linkLine(link: PeerLink): string {
  const rejected = link.rejectedFrames > 0 ? `${link.rejectedFrames} ${link.rejectedFrames === 1 ? 'frame' : 'frames'} with a bad signature` : null;
  return [link.address, link.user ? `${link.user}${link.host ? ` on ${link.host}` : ''}` : null, link.message, rejected].filter(Boolean).join(' · ');
}

interface PeersPanelProps {
  draft: PeersDraft;
  row: PeersConnectionSummary | undefined;
  target: ConnectionId | null;
  request: number;
}

/** Connections › Peers (AL-289, PL§2): the port, the team secret and the peers this app talks to, each with its state. */
export function PeersPanel({ draft, row, target, request }: PeersPanelProps) {
  const network = usePeerNetwork();
  const testSaved = useTestConnection();
  const removeConnection = useRemoveConnection();
  const [testing, setTesting] = useState(false);
  const { startReplace, secretRef } = draft;
  const listener = listenerText(network.data);
  const listenerFailed = network.data?.listener.state === 'failed';

  useEffect(() => {
    if (row && target === row.id) startReplace(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, target, row?.id]);

  function retest(id: ConnectionId) {
    setTesting(true);
    testSaved.mutate({ id }, { onSettled: () => setTesting(false) });
  }

  const probes = draft.test.result?.peers ?? [];

  return (
    <View style={styles.panel} testID="connections-peers">
      <Text variant="body">
        Agent Lanes on other computers in the office, so agents on the same Feature can see each other and talk. Everyone uses the same team secret; nothing is sent to Azure DevOps.
      </Text>
      {row ? (
        <ConnectionRow
          name={row.name}
          status={connectionStatusView(row)}
          details={peersRowDetails(row)}
          problem={row.status === 'error' ? (row.statusMessage ?? 'The test failed.') : listenerFailed ? listener : null}
          highlighted={draft.replacing?.id === row.id}
          testID={`connection-${row.id}`}
          actions={
            <>
              <Button label="Test" variant="secondary" size="sm" loading={testing} onPress={() => retest(row.id)} testID={`connection-${row.id}-test`} />
              <Button label="Change" variant="secondary" size="sm" onPress={() => startReplace(row)} testID={`connection-${row.id}-replace`} />
              <RemoveConnectionButton name={row.name} busy={removeConnection.isPending} onRemove={() => removeConnection.mutate(row.id)} testID={`connection-${row.id}-remove`} />
            </>
          }
        >
          {listener && !listenerFailed ? (
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
        </ConnectionRow>
      ) : null}

      <ConnectionForm
        title={draft.replacing ? 'Change peer lanes' : 'Set up peer lanes'}
        aside={draft.replacing ? <Button label="Cancel change" variant="secondary" size="sm" onPress={draft.cancelReplace} /> : undefined}
        testID="peers-draft"
      >
        <View style={styles.pair}>
          <TextField
            label="Port"
            help="Other apps reach this one on it. Windows asks once to allow it on private networks."
            value={draft.port}
            onChangeText={draft.setPort}
            error={draft.portError}
            inputMode="numeric"
            autoComplete="off"
            style={styles.port}
            testID="peers-port"
          />
          <View style={styles.grow}>
            <TextField
              ref={secretRef}
              variant="secure"
              label={draft.replacing ? 'Team secret (leave empty to keep it)' : 'Team secret'}
              help="The same on every computer. Shared the way you share a PAT; never shown again after you save."
              onSecretChange={draft.onSecretChange}
              testID="peers-secret"
            />
            <View style={styles.generate}>
              <Button label="Generate" variant="secondary" size="sm" onPress={draft.generate} testID="peers-generate" />
              {draft.generated ? (
                <Text variant="mono" size="xs" selectable testID="peers-generated" style={styles.grow}>
                  {draft.generated}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.list}>
          <Text variant="title">Peers</Text>
          {draft.peers.map((peer, index) => (
            <View key={index} style={styles.peerRow}>
              <TextField
                aria-label={`Peer ${index + 1}`}
                placeholder="KYLE-PC or 10.0.0.12:47812"
                value={peer}
                onChangeText={(value) => draft.setPeer(index, value)}
                error={draft.peerErrors[index] ?? null}
                autoComplete="off"
                style={styles.grow}
                testID={`peers-address-${index}`}
              />
              <Button label="Remove" variant="secondary" size="sm" onPress={() => draft.removePeer(index)} testID={`peers-remove-${index}`} />
            </View>
          ))}
          <View style={styles.buttons}>
            <Button label="Add peer" variant="secondary" size="sm" onPress={draft.addPeer} testID="peers-add" />
          </View>
        </View>
        <View style={styles.buttons}>
          <Button
            label="Test connection"
            variant="secondary"
            loading={draft.test.state === 'testing'}
            disabled={!draft.canTest && draft.test.state !== 'testing'}
            onPress={() => void draft.runTest()}
            testID="peers-test-connection"
          />
        </View>
        <TestOutcome test={draft.test} passedText={probeSummary(probes)} testID="peers-test-outcome" />
        {probes.map((probe, index) => (
          <View key={probe.address} style={styles.peer} testID={`peers-probe-${index}`}>
            <Pill label={PROBE_VIEW[probe.outcome].label} tone={PROBE_VIEW[probe.outcome].tone} dot />
            <Text variant="meta" selectable style={styles.grow}>
              {[probe.address, probe.user ? `${probe.user}${probe.host ? ` on ${probe.host}` : ''}` : null, probe.message].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))}
        {draft.saveError ? (
          <Text variant="meta" color={tone.danger.text} role="alert">
            {draft.saveError}
          </Text>
        ) : null}
      </ConnectionForm>
    </View>
  );
}

/** `2 answered · 1 unreachable`, or what to do when nobody is listed. */
export function probeSummary(probes: readonly PeerProbe[]): string {
  if (probes.length === 0) return 'No peers listed yet; this app will listen for them';
  const answered = probes.filter((probe) => probe.outcome === 'answered').length;
  const unreachable = probes.length - answered;
  return [`${answered} answered`, unreachable > 0 ? `${unreachable} unreachable` : null].filter(Boolean).join(' · ');
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
    width: 140,
  },
  grow: {
    flex: 1,
    flexShrink: 1,
  },
  generate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
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
