import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { DESIGN_THREAD_TEXT_MAX, type DesignThreadApproval, type DesignThreadMessage } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text, TextField } from '@agent-lanes/ui';
import { useAnswerDesignApproval, useDesignThread, useSendDesignMessage } from '@/shared/api';
import { SideSection } from './SideSection';

export interface DesignThreadSectionProps {
  ticketId: string;
  /** A canvas is linked to the ticket. */
  canvasLinked: boolean;
  /**
   * The in-app thread is the design thread: MCP link mode, or a webview that can't sign in (D120).
   * Otherwise the canvas's own Claude chat, inside the live view, is the thread.
   */
  inApp: boolean;
}

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * "Design thread" (AL-196, R11): talk to the design side of the ticket at any stage, Queued to Done,
 * while the agent keeps running. In webview mode the canvas's own Claude chat is the thread; in MCP
 * link mode (or when the webview can't sign in) this panel is, backed by the ticket's design session in
 * main. Nothing said here reaches the implementation agent until a design is shipped (AL-197).
 */
export function DesignThreadSection({ ticketId, canvasLinked, inApp }: DesignThreadSectionProps) {
  return (
    <SideSection title="Design thread" testID="design-thread">
      {!inApp ? (
        <Text variant="meta" size="sm" testID="design-thread-canvas-chat">
          Talk to the design in the canvas&apos;s own Claude chat. It stays open while you switch tabs and stages, and the agent keeps working
          meanwhile.
        </Text>
      ) : !canvasLinked ? (
        <Text variant="meta" size="sm">
          Link a canvas to talk to the design side of this ticket.
        </Text>
      ) : (
        <InAppThread ticketId={ticketId} />
      )}
    </SideSection>
  );
}

function InAppThread({ ticketId }: { ticketId: string }) {
  const query = useDesignThread(ticketId);
  const send = useSendDesignMessage(ticketId);
  const answer = useAnswerDesignApproval(ticketId);
  const [draft, setDraft] = useState('');
  const list = useRef<ScrollViewInstance>(null);
  const thread = query.data;
  const messages = thread?.messages ?? [];

  // The newest message stays in view as replies arrive.
  useEffect(() => {
    list.current?.scrollToEnd({ animated: false });
  }, [messages.length, thread?.approval]);

  const text = draft.trim();
  const submit = () => {
    if (!text || send.isPending) return;
    send.mutate(text, { onSuccess: () => setDraft('') });
  };

  return (
    <>
      <Text variant="meta" size="sm">
        A design session of its own reads the canvas and answers here. The agent keeps working, and hears none of this until you ship a design.
      </Text>

      {messages.length > 0 || thread?.approval ? (
        <ScrollView ref={list} style={styles.list} contentContainerStyle={styles.listContent} role="log" aria-label="Design thread messages">
          {messages.map((message) => (
            <ThreadMessage key={message.id} message={message} />
          ))}
          {thread?.approval ? (
            <ApprovalCard
              approval={thread.approval}
              busy={answer.isPending}
              onAnswer={(approve) => answer.mutate({ approvalId: thread.approval!.id, approve })}
            />
          ) : null}
        </ScrollView>
      ) : query.isPending ? (
        <Text variant="meta" size="sm">
          Loading the thread…
        </Text>
      ) : (
        <Text variant="meta" size="sm" testID="design-thread-empty">
          No messages yet. Ask about the canvas, or ask for a change.
        </Text>
      )}

      <Text variant="meta" size="sm" aria-live="polite" testID="design-thread-status" color={thread?.status === 'unavailable' ? tone.attention.text : undefined}>
        {thread?.status === 'replying'
          ? 'Design is replying…'
          : thread?.status === 'unavailable'
            ? (thread.reason ?? "Claude Design isn't available.")
            : ''}
      </Text>
      {query.isError || send.isError ? (
        <Text variant="meta" size="sm" color={tone.danger.text} role="alert">
          {(send.error ?? query.error)?.message}
        </Text>
      ) : null}

      <TextField
        variant="multiline"
        rows={3}
        aria-label="Message to the design side"
        placeholder="Ask the design side…"
        value={draft}
        onChangeText={setDraft}
        maxLength={DESIGN_THREAD_TEXT_MAX}
        testID="design-thread-input"
      />
      <Button
        label="Send to design"
        variant="primary"
        trailingIcon="arrow-right"
        justify="between"
        disabled={!text}
        loading={send.isPending}
        onPress={submit}
        testID="design-thread-send"
      />
    </>
  );
}

function ThreadMessage({ message }: { message: DesignThreadMessage }) {
  if (message.role === 'notice') {
    return (
      <Text
        variant="meta"
        size="xs"
        color={message.error ? tone.danger.text : color.muted}
        style={styles.notice}
        role={message.error ? 'alert' : undefined}
        testID="design-thread-notice"
      >
        {`${clock(message.at)} · ${message.text}`}
      </Text>
    );
  }
  const mine = message.role === 'user';
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]} testID={mine ? 'design-thread-user' : 'design-thread-reply'}>
      <Text variant="meta" size="xs" color={mine ? color.claudeText : color.muted}>
        {`${mine ? 'You' : 'Design'} · ${clock(message.at)}`}
      </Text>
      <Text variant="body" selectable>
        {message.text}
      </Text>
    </View>
  );
}

function ApprovalCard({ approval, busy, onAnswer }: { approval: DesignThreadApproval; busy: boolean; onAnswer: (approve: boolean) => void }) {
  return (
    <View style={styles.approval} role="group" aria-label="Canvas change waiting for you" testID="design-thread-approval">
      <Text variant="title" size="sm" color={tone.attention.text}>
        {`Needs you · change the canvas (${approval.operation})`}
      </Text>
      <Text variant="mono" size="xs" selectable numberOfLines={12}>
        {approval.summary}
      </Text>
      <View style={styles.approvalActions}>
        <Button label="Approve change" size="sm" variant="primary" disabled={busy} onPress={() => onAnswer(true)} testID="design-thread-approve" />
        <Button label="Decline" size="sm" disabled={busy} onPress={() => onAnswer(false)} testID="design-thread-decline" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 360,
    flexGrow: 0,
  },
  listContent: {
    gap: space.sm,
  },
  bubble: {
    gap: 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    maxWidth: '92%',
  },
  mine: {
    alignSelf: 'flex-end',
    borderColor: tone.claude.border,
    backgroundColor: tone.claude.wash,
  },
  theirs: {
    alignSelf: 'flex-start',
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  notice: {
    textAlign: 'center',
  },
  approval: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: tone.attention.border,
    backgroundColor: tone.attention.band,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xs,
  },
});
