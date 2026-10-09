import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { PermissionRequest } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text, TextField } from '@agent-lanes/ui';
import { usePendingPermission, useResolvePermission } from '../api/permission';

export interface PermissionPromptProps {
  ticketId: string;
  /**
   * `banner`: the full prompt above the stream (the board card, a ticket whose row is not drawn);
   * `inline`: at the tool row that waits, with the whole input (AL-260);
   * `compact`: one line with the answers, kept at the top while the row is open elsewhere.
   */
  variant?: 'banner' | 'inline' | 'compact';
  /** Inline: render only when the waiting request is for one of these tool uses. */
  toolUseIds?: readonly string[];
  testID?: string;
}

/**
 * "Needs you · permission" (AL-109, AL-260): the tool call the agent waits on, with Allow once,
 * Allow for this ticket, Always allow (a rule the repo remembers), and Deny with a reason the agent
 * reads. Renders nothing while no request waits.
 */
export function PermissionPrompt({ ticketId, variant = 'banner', toolUseIds, testID = `permission-${ticketId}` }: PermissionPromptProps) {
  const pending = usePendingPermission(ticketId);
  const request = pending.data?.request;
  if (!request) return null;
  if (variant === 'inline' && toolUseIds && (!request.toolUseId || !toolUseIds.includes(request.toolUseId))) return null;
  return <WaitingPrompt key={request.requestId} ticketId={ticketId} request={request} variant={variant} testID={testID} />;
}

function WaitingPrompt({ ticketId, request, variant, testID }: { ticketId: string; request: PermissionRequest; variant: 'banner' | 'inline' | 'compact'; testID: string }) {
  const resolve = useResolvePermission(ticketId);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const busy = resolve.isPending;

  const allowOnce = () => resolve.mutate({ requestId: request.requestId, decision: 'allow-once' });
  const allowTicket = () => resolve.mutate({ requestId: request.requestId, decision: 'allow-ticket' });
  const allowAlways = () => resolve.mutate({ requestId: request.requestId, decision: 'allow-pattern', rule: request.suggestedRule ?? undefined });
  const deny = () => resolve.mutate({ requestId: request.requestId, decision: 'deny', ...(reason.trim() ? { reason: reason.trim() } : {}) });

  const answers = (
    <View style={styles.actions}>
      <Button size="sm" variant="primary" label="Allow once" loading={busy} onPress={allowOnce} testID={`${testID}-allow-once`} />
      <Button size="sm" label="Allow for this ticket" disabled={busy} onPress={allowTicket} />
      {request.suggestedRule ? (
        <Button size="sm" label={`Always allow ${request.suggestedRule}`} disabled={busy} onPress={allowAlways} testID={`${testID}-allow-always`} />
      ) : null}
      {denying ? null : <Button size="sm" variant="danger" label="Deny…" disabled={busy} onPress={() => setDenying(true)} testID={`${testID}-deny`} />}
    </View>
  );

  const denyBox = denying ? (
    <View style={styles.deny}>
      <TextField
        variant="multiline"
        label="Tell the agent why (optional)"
        rows={2}
        value={reason}
        onChangeText={setReason}
        placeholder="Use the existing script instead"
        autoFocus
        testID={`${testID}-deny-reason`}
      />
      <View style={styles.actions}>
        <Button size="sm" variant="danger" label="Deny" loading={busy} onPress={deny} testID={`${testID}-deny-send`} />
        <Button size="sm" variant="secondary" label="Cancel" disabled={busy} onPress={() => setDenying(false)} />
      </View>
    </View>
  ) : null;

  if (variant === 'compact') {
    return (
      <View role="group" aria-label={`Permission for ${request.tool}`} style={[styles.box, styles.compact]} testID={testID}>
        <Text variant="title" size="sm" color={tone.attention.text} numberOfLines={1} style={styles.compactTitle}>
          {`Needs you · allow ${request.tool}${request.detail ? ` · ${request.detail}` : ''}`}
        </Text>
        {answers}
        {denyBox}
      </View>
    );
  }

  return (
    <View role="group" aria-label={`Permission for ${request.tool}`} style={[styles.box, variant === 'inline' && styles.inline]} testID={testID}>
      <Text variant="title" size="sm" color={tone.attention.text}>
        {`Needs you · allow ${request.tool}`}
      </Text>
      <Text variant="body" size="sm" color={tone.attention.text}>
        {request.title}
      </Text>
      {request.input ?? request.detail ? (
        <ScrollView style={styles.inputScroll} nestedScrollEnabled>
          <Text variant="mono" size="xs" color={color.ink} selectable style={styles.input} testID={`${testID}-detail`}>
            {request.input ?? request.detail}
          </Text>
        </ScrollView>
      ) : null}
      {answers}
      {denyBox}
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
  inline: {
    marginTop: space.xs,
    borderRadius: radius.chip + 2,
  },
  compact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  compactTitle: {
    flex: 1,
    minWidth: 200,
  },
  inputScroll: {
    maxHeight: 180,
    borderRadius: radius.chip,
    backgroundColor: color.surface,
  },
  input: {
    padding: space.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
  deny: {
    gap: space.sm,
    marginTop: space.xs,
  },
});
