import { EFFORTS, MODELS, type Effort, type Model } from '@agent-lanes/contracts';
import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { SegmentedControl, StatusBadge, Text } from '@agent-lanes/ui';
import {
  EFFORT_LABELS,
  MODEL_LABELS,
  agentTickets,
  useSetAgentEffort,
  useSetAgentModel,
  type AgentTicketStore,
} from '@/entities/agent-ticket';
import { toast } from '@/shared/model';
import { modelControls, type ModelControlsTicket } from '../model/controls';

export interface ModelEffortControlsProps {
  ticket: ModelControlsTicket;
  /** The store the switch is shown in; the app's own by default. */
  store?: AgentTicketStore;
}

const MODEL_OPTIONS = MODELS.map((model) => ({ value: model, label: MODEL_LABELS[model] }));
const EFFORT_SPOKEN: Readonly<Record<Effort, string>> = {
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
  xhigh: 'Extra high effort',
  max: 'Max effort',
};
const EFFORT_OPTIONS = EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort], accessibilityLabel: EFFORT_SPOKEN[effort] }));

/**
 * The Agent panel's body (AL-172, artboard 3, R7): the model on a track (Opus / Sonnet / Haiku) and
 * the effort as pills (Low … Max). A pick shows at once and the panel says "Switching · next turn"
 * until main reports the session using it (`agent:model`, AL-106). A refused change puts the
 * switchers back and raises a toast.
 */
export function ModelEffortControls({ ticket, store = agentTickets }: ModelEffortControlsProps) {
  const setModel = useSetAgentModel(store);
  const setEffort = useSetAgentEffort(store);
  const view = modelControls(ticket);

  // What the segments showed before the pick, to put back if main refuses the change.
  const previous = { model: view.model, effort: view.effort };
  const onError = (title: string) => (cause: unknown) => {
    store.requestModelChange(ticket.id, previous, Date.now());
    toast({ id: `change-model:${ticket.id}`, tone: 'error', title, body: cause instanceof Error ? cause.message : undefined });
  };

  return (
    <ModelEffortControlsView
      ticket={ticket}
      onModel={(model) => setModel.mutate({ ticketId: ticket.id, model }, { onError: onError("Couldn't switch the model") })}
      onEffort={(effort) => setEffort.mutate({ ticketId: ticket.id, effort }, { onError: onError("Couldn't change the effort") })}
    />
  );
}

export interface ModelEffortControlsViewProps {
  ticket: ModelControlsTicket;
  onModel(model: Model): void;
  onEffort(effort: Effort): void;
}

/** The switchers with no actions behind them: the panel body, and the component gallery's samples. */
export function ModelEffortControlsView({ ticket, onModel, onEffort }: ModelEffortControlsViewProps) {
  const view = modelControls(ticket);
  const disabled = view.disabledReason !== null;
  return (
    <View style={styles.body} testID="model-effort-controls">
      <SegmentedControl<Model>
        label="Model"
        options={MODEL_OPTIONS}
        value={view.model}
        onChange={onModel}
        disabled={disabled}
        fill
        testID="agent-model"
      />
      <SegmentedControl<Effort>
        label="Effort"
        variant="pills"
        options={EFFORT_OPTIONS}
        value={view.effort}
        onChange={onEffort}
        disabled={disabled}
        fill
        testID="agent-effort"
      />
      <View aria-live="polite" style={styles.status}>
        {view.switchingLine ? (
          <View style={styles.switching} testID="agent-switching">
            <StatusBadge status="switching" />
            <Text variant="meta" numberOfLines={1} style={styles.flexText}>
              {view.switchingLine}
            </Text>
          </View>
        ) : view.disabledReason ? (
          <Text variant="meta">{view.disabledReason}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.md,
  },
  status: {
    minHeight: 0,
  },
  switching: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  flexText: {
    flexShrink: 1,
  },
});
