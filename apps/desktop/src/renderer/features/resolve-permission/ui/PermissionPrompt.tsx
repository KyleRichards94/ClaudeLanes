import { StyleSheet, View } from 'react-native';
import { radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import { usePendingPermission, useResolvePermission } from '../api/permission';

export interface PermissionPromptProps {
  ticketId: string;
  testID?: string;
}

/**
 * "Needs you · permission" (AL-109): the tool call the agent waits on, with Allow once, Allow for
 * this ticket and Deny. Shown under the ticket's card on the board and in its drill-in; renders
 * nothing while no request waits.
 */
export function PermissionPrompt({ ticketId, testID = `permission-${ticketId}` }: PermissionPromptProps) {
  const pending = usePendingPermission(ticketId);
  const resolve = useResolvePermission(ticketId);
  const request = pending.data?.request;
  if (!request) return null;

  const answer = (decision: 'allow-once' | 'allow-ticket' | 'deny') => resolve.mutate({ requestId: request.requestId, decision });
  return (
    <View role="group" aria-label={`Permission for ${request.tool}`} style={styles.box} testID={testID}>
      <Text variant="title" size="sm" color={tone.attention.text}>
        {`Needs you · allow ${request.tool}`}
      </Text>
      <Text variant="body" size="sm" color={tone.attention.text}>
        {request.title}
      </Text>
      {request.detail ? (
        <Text variant="mono" size="xs" color={tone.attention.text} numberOfLines={3} selectable testID={`${testID}-detail`}>
          {request.detail}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button size="sm" variant="primary" label="Allow once" loading={resolve.isPending} onPress={() => answer('allow-once')} />
        <Button size="sm" label="Allow for this ticket" disabled={resolve.isPending} onPress={() => answer('allow-ticket')} />
        <Button size="sm" variant="danger" label="Deny" disabled={resolve.isPending} onPress={() => answer('deny')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: tone.attention.border,
    backgroundColor: tone.attention.band,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
});
