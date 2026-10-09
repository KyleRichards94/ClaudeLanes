import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Text, TextField } from '@agent-lanes/ui';
import { GATE_ASKS, LANE_LABELS, agentTickets, useAgentTicket, useResolveGate, type AgentTicketGate, type AgentTicketStore } from '@/entities/agent-ticket';

export interface GateActionsProps {
  ticketId: string;
  /** `card` under a board card; `stepper` beside the drill-in's stage stepper (AL-171). */
  placement: 'card' | 'stepper';
  store?: AgentTicketStore;
  style?: StyleProp<ViewStyle>;
}

/**
 * Approve / Request changes for the ticket's waiting gate (AL-104, AL-171, design §9 step 2). The
 * board card and the drill-in stepper render this same control over the same `agent:resolveGate`
 * action and the same store entry, so deciding in one place clears the other. Nothing renders while
 * no gate waits. Request changes asks for a note first; the agent reads it as the tool result.
 */
export function GateActions({ ticketId, placement, store = agentTickets, style }: GateActionsProps) {
  const gate = useAgentTicket(ticketId, store)?.gate ?? null;
  // Keyed by when the gate opened, so a new gate starts without the last one's note.
  return gate ? <WaitingGate key={gate.openedAt} ticketId={ticketId} placement={placement} store={store} style={style} gate={gate} /> : null;
}

function WaitingGate({ ticketId, placement, store, style, gate }: Required<Omit<GateActionsProps, 'style'>> & Pick<GateActionsProps, 'style'> & { gate: AgentTicketGate }) {
  const resolve = useResolveGate(store);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const ask = GATE_ASKS[gate.stage];
  const failure = resolve.error ? `Couldn't send that: ${resolve.error.message}` : null;
  const prefix = `gate-${placement}-${ticketId}`;

  const sendChanges = () => {
    const text = note.trim();
    if (!text) {
      setNoteError('Say what the agent should change.');
      return;
    }
    resolve.mutate({ ticketId, decision: 'request-changes', note: text }, { onSuccess: () => setNoteOpen(false) });
  };

  return (
    <View
      role="group"
      aria-label={`${LANE_LABELS[gate.stage]} gate: ${ask}`}
      style={[styles.box, placement === 'card' && styles.boxCard, style]}
      testID={prefix}
    >
      {placement === 'stepper' ? (
        <View style={styles.head}>
          <Icon name="lock" size={14} color={tone.attention.dot} />
          <Text variant="title" size="sm" color={tone.attention.text}>
            {`Waiting for you · ${ask}`}
          </Text>
        </View>
      ) : null}
      {/* What the agent asked to have approved, as it said it in `set_stage` (AL-254). */}
      {gate.summary ? (
        <Text variant="body" size="sm" selectable testID={`${prefix}-summary`}>
          {gate.summary}
        </Text>
      ) : null}
      {noteOpen ? (
        <View style={styles.note}>
          <TextField
            variant="multiline"
            label="What should change?"
            rows={3}
            value={note}
            onChangeText={(text) => {
              setNote(text);
              setNoteError(null);
            }}
            error={noteError}
            autoFocus
            testID={`${prefix}-note`}
          />
          <View style={styles.row}>
            <Button variant="strong" size="sm" label="Send changes" onPress={sendChanges} loading={resolve.isPending} testID={`${prefix}-send`} />
            <Button variant="secondary" size="sm" label="Cancel" onPress={() => setNoteOpen(false)} disabled={resolve.isPending} />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Button
            variant="primary"
            size="sm"
            icon="check"
            label="Approve"
            onPress={() => resolve.mutate({ ticketId, decision: 'approve' })}
            loading={resolve.isPending}
            testID={`${prefix}-approve`}
          />
          <Button variant="secondary" size="sm" label="Request changes" onPress={() => setNoteOpen(true)} disabled={resolve.isPending} testID={`${prefix}-changes`} />
        </View>
      )}
      {failure ? (
        <Text variant="body" size="sm" color={tone.danger.text} role="alert">
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    // Full width under the stepper, so the Request changes box is not a narrow column (AL-254).
    alignSelf: 'stretch',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: tone.attention.border,
    backgroundColor: tone.attention.band,
  },
  boxCard: {
    marginTop: -space.xs,
    padding: space.sm,
    backgroundColor: color.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  note: {
    gap: space.sm,
  },
});
