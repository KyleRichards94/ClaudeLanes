import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useStore } from 'zustand';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Modal, Pill, Text, type PillTone } from '@agent-lanes/ui';
import { agentTickets, type AgentTicketStore } from '@/entities/agent-ticket';
import { useReconnectSession } from '@/shared/api';
import { LANE_LABELS } from '@/shared/config';
import { toast } from '@/shared/model';
import { routes, useNavigation } from '@/shared/routing';
import { useNextActions, useSendSuggestion } from '../api/next-actions';
import { DIGEST_HEADINGS, boardDigest, digestText, type DigestEntry, type DigestKind } from '../model/digest';

const KIND_TONES: Readonly<Record<DigestKind, PillTone>> = {
  'needs-you': 'attention',
  dead: 'danger',
  'build-failed': 'danger',
  finished: 'ok',
  quiet: 'neutral',
  queued: 'neutral',
  working: 'claude',
  done: 'ok',
};

export interface DigestPanelProps {
  visible: boolean;
  onClose(): void;
  store?: AgentTicketStore;
  now?: () => number;
  testID?: string;
}

/**
 * The board digest (AL-272): every agent ticket ranked by what it needs, from the store alone, with
 * Open and Resume on each row; "Generate next actions" asks one short Claude session for a next step
 * per ticket, each with "Send to agent".
 */
export function DigestPanel({ visible, onClose, store = agentTickets, now = Date.now, testID = 'board-digest' }: DigestPanelProps) {
  const byId = useStore(store, (state) => state.byId);
  const entries = useMemo(() => boardDigest([...byId.values()], now()), [byId, now]);
  const nextActions = useNextActions();
  const suggestions = useMemo(() => new Map((nextActions.data?.actions ?? []).map((action) => [action.ticketId, action.text])), [nextActions.data]);
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const send = useSendSuggestion();

  const generate = () => nextActions.mutate(digestText(entries));
  const onSent = (ticketId: string) => setSent((ids) => new Set([...ids, ticketId]));

  return (
    <Modal
      visible={visible}
      title="Board digest"
      subtitle={entries.length === 0 ? 'No agent tickets yet' : `${entries.length} ${entries.length === 1 ? 'ticket' : 'tickets'}, what needs you first`}
      icon="backlog"
      width={720}
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Button label="Close" onPress={onClose} />
          <Button
            variant="primary"
            icon="agent"
            label={nextActions.data ? 'Generate again' : 'Generate next actions'}
            onPress={generate}
            loading={nextActions.isPending}
            disabled={entries.length === 0}
            testID={`${testID}-generate`}
          />
        </View>
      }
      testID={`${testID}-modal`}
    >
      <ScrollView style={styles.scroll}>
        <View style={styles.list} role="list" aria-label="Board digest">
          {entries.map((entry) => (
            <DigestRow
              key={entry.ticketId}
              entry={entry}
              suggestion={suggestions.get(entry.ticketId) ?? null}
              sent={sent.has(entry.ticketId)}
              onSend={(text) => send.mutate({ ticketId: entry.ticketId, text }, { onSuccess: () => onSent(entry.ticketId), onError: (error) => toast({ id: `digest-send:${entry.ticketId}`, tone: 'error', title: `Couldn't message ${entry.label}`, body: error.message }) })}
              sending={send.isPending && send.variables?.ticketId === entry.ticketId}
              onClose={onClose}
              testID={`${testID}-${entry.ticketId}`}
            />
          ))}
          {nextActions.error ? (
            <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID={`${testID}-error`}>
              {nextActions.error.message}
            </Text>
          ) : nextActions.data ? (
            <Text variant="meta" size="xs" testID={`${testID}-model`}>
              {`Next actions from ${nextActions.data.model}.`}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Modal>
  );
}

function DigestRow({ entry, suggestion, sent, sending, onSend, onClose, testID }: { entry: DigestEntry; suggestion: string | null; sent: boolean; sending: boolean; onSend(text: string): void; onClose(): void; testID: string }) {
  const { navigate } = useNavigation();
  const reconnect = useReconnectSession(entry.ticketId);
  const open = () => {
    onClose();
    navigate(routes.ticket(entry.ticketId));
  };
  return (
    <View role="listitem" style={styles.row} testID={testID}>
      <View style={styles.rowHead}>
        <Pill label={DIGEST_HEADINGS[entry.kind]} tone={KIND_TONES[entry.kind]} dot />
        <Text variant="title" size="sm" numberOfLines={1} style={styles.flex}>
          {`${entry.label} · ${entry.title}`}
        </Text>
        <Text variant="meta" size="xs">
          {LANE_LABELS[entry.stage]}
        </Text>
      </View>
      {entry.reasons.length > 0 ? (
        <Text variant="body" size="sm" color={color.muted} numberOfLines={2} testID={`${testID}-reasons`}>
          {entry.reasons.join(' · ')}
        </Text>
      ) : null}
      {suggestion ? (
        <View style={styles.suggestion} testID={`${testID}-suggestion`}>
          <Text variant="body" size="sm" selectable style={styles.flex}>
            {suggestion}
          </Text>
          <Button size="sm" variant="secondary" icon="send" label={sent ? 'Sent' : 'Send to agent'} disabled={sent} loading={sending} onPress={() => onSend(suggestion)} testID={`${testID}-send`} />
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button size="sm" label="Open" onPress={open} testID={`${testID}-open`} />
        {entry.action === 'resume' ? (
          <Button
            size="sm"
            variant="primary"
            icon="refresh"
            label="Resume"
            loading={reconnect.isPending}
            onPress={() => reconnect.mutate(undefined, { onError: (error) => toast({ id: `digest-resume:${entry.ticketId}`, tone: 'error', title: `Couldn't resume ${entry.label}`, body: error.message }) })}
            testID={`${testID}-resume`}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 560,
  },
  list: {
    gap: space.sm,
  },
  row: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  flex: {
    flex: 1,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.chip,
    backgroundColor: color.bg,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
});
