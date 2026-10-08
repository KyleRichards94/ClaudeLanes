import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import { useSessionStatus, useStartNow } from '../api/session-status';

export interface QueuedNoticeProps {
  ticketId: string;
  testID?: string;
}

/**
 * The Queued lane's notice in the drill-in (AL-111): "Waiting for a free slot" while the ticket's repo
 * is at its agent cap, with "Start now" to start it at once, over the cap. Renders nothing otherwise.
 */
export function QueuedNotice({ ticketId, testID = `queued-${ticketId}` }: QueuedNoticeProps) {
  const status = useSessionStatus(ticketId);
  const startNow = useStartNow(ticketId);
  if (status.data?.state !== 'queued') return null;

  return (
    <View role="group" aria-label="Queued" style={styles.box} testID={testID}>
      <View style={styles.text}>
        <Text variant="title" size="sm">
          {status.data.message ?? 'Waiting for a free slot'}
        </Text>
        <Text variant="meta" size="md">
          {startNow.isError
            ? `Couldn't start it: ${startNow.error instanceof Error ? startNow.error.message : String(startNow.error)}`
            : 'This repo is running as many agents as its settings allow. The ticket starts when one finishes.'}
        </Text>
      </View>
      <Button size="sm" variant="primary" label="Start now" loading={startNow.isPending} onPress={() => startNow.mutate()} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  text: {
    flex: 1,
    minWidth: 240,
    gap: space.xs,
  },
});
