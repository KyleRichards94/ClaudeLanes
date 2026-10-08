import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Card, CardSection, IdChip, Pill, ProgressBar, Text, type CardSectionTone, type ProgressTone } from '@agent-lanes/ui';
import { LANE_LABELS } from '@/shared/config';
import { WorkItemStateLabel, WorkItemTypeBar } from '@/shared/ui';
import { useAgentTicket } from '../model/hooks';
import type { AgentTicketStore } from '../model/store';
import type { AgentTicket } from '../model/types';
import { cardView, type CardActivityTone } from './card-view';

export interface AgentTicketCardViewProps {
  ticket: AgentTicket;
  /**
   * The work item's state in Azure DevOps ("Active", "Resolved"), shown top right beside the id (R6).
   * It is server data (TanStack Query, AL-066), so the board passes it in; omitted, the corner is empty.
   */
  adoState?: string | null;
  /**
   * ADO's colour for the work item's type (the bar beside the id) and for its state (the dot before
   * it), from `ado:workItemColors`. Null or omitted uses the token colours. Words carry the meaning;
   * the colours only echo ADO's board.
   */
  typeColor?: string | null;
  stateColor?: string | null;
  /** The ticket open in the drill-in or picked with the keyboard: violet outline (artboard 6 "Selected"). */
  selected?: boolean;
  /** Opens the ticket's drill-in. */
  onPress?: () => void;
  testID?: string;
}

/**
 * The agent ticket card (artboards 1 and 6): id chip and ADO state, title, activity row with its dot,
 * progress bar, "Model · Effort" and sub-agents, and a status band when the ticket needs something.
 * Presentational: give it a ticket; `AgentTicketCard` reads one from the store.
 */
export function AgentTicketCardView({ ticket, adoState, typeColor = null, stateColor = null, selected = false, onPress, testID }: AgentTicketCardViewProps) {
  const view = cardView(ticket);
  const cardTone = selected ? 'selected' : view.border;
  const activityTone = activityTones[view.activity.tone];
  const name = [
    ticket.ado ? `#${ticket.ado.workItemId}` : ticket.id,
    ticket.title,
    LANE_LABELS[ticket.stage],
    view.activity.text,
    view.design?.label,
    view.footer?.label,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      testID={testID}
      role="button"
      aria-label={name}
      onPress={onPress}
      // The whole card is the target (artboard 1); the global :focus-visible ring follows its radius.
      style={styles.target}
    >
      <Card tone={cardTone} footer={view.footer ?? undefined} testID={testID ? `${testID}-card` : undefined}>
        <CardSection>
          <View style={styles.idRow}>
            {ticket.ado ? (
              <View style={styles.adoId}>
                <WorkItemTypeBar typeColor={typeColor} testID={testID ? `${testID}-type` : undefined} />
                <IdChip id={ticket.ado.workItemId} />
              </View>
            ) : (
              <View style={styles.localId}>
                <Text variant="mono" size="xs" color={tone.neutral.text} numberOfLines={1}>
                  {ticket.id}
                </Text>
              </View>
            )}
            {adoState ? <WorkItemStateLabel state={adoState} stateColor={stateColor} testID={testID ? `${testID}-state` : undefined} /> : null}
          </View>
          <Text variant="title" size="md" numberOfLines={3} style={styles.title}>
            {ticket.title}
          </Text>
          {view.design ? (
            // A shipped design spec (AL-200); amber while the agent has not acknowledged it.
            <Pill
              label={view.design.label}
              tone={view.design.tone}
              dot={view.design.tone === 'attention'}
              style={styles.design}
              testID={testID ? `${testID}-design` : undefined}
            />
          ) : null}
        </CardSection>
        <CardSection tone={sectionTone(view.activity.tone)} style={view.activity.tone === 'neutral' ? styles.neutralWash : undefined}>
          <View style={styles.activityRow}>
            <View aria-hidden style={[styles.dot, { backgroundColor: activityTone.dot }]} />
            <Text variant="body" size="sm" color={activityTone.text} numberOfLines={2} style={styles.activityText}>
              {view.activity.text}
            </Text>
          </View>
          <ProgressBar
            progress={view.progress}
            tone={progressTone(view.activity.tone)}
            label={`${LANE_LABELS[ticket.stage]} progress`}
            style={[styles.bar, view.activity.tone === 'neutral' ? styles.neutralBar : undefined]}
          />
          <View style={styles.metaRow}>
            <Text variant="meta" size="xs" numberOfLines={1} style={styles.model}>
              {view.modelLine}
            </Text>
            <Text variant="meta" size="xs" numberOfLines={1}>
              {view.subAgentsLine}
            </Text>
          </View>
        </CardSection>
      </Card>
    </Pressable>
  );
}

export interface AgentTicketCardProps extends Omit<AgentTicketCardViewProps, 'ticket'> {
  ticketId: string;
  /** For tests and the component gallery; the app uses its store. */
  store?: AgentTicketStore;
}

/** A card that follows one ticket in the store; it re-renders only when that ticket changes (AL-141). */
export function AgentTicketCard({ ticketId, store, ...props }: AgentTicketCardProps) {
  const ticket = useAgentTicket(ticketId, store);
  if (!ticket) return null;
  return <AgentTicketCardView ticket={ticket} {...props} />;
}

const activityTones: Record<CardActivityTone, { dot: string; text: string }> = {
  claude: { dot: tone.claude.dot, text: tone.claude.text },
  ado: { dot: tone.ado.dot, text: tone.ado.text },
  danger: { dot: tone.danger.dot, text: tone.danger.text },
  ok: { dot: tone.ok.dot, text: tone.ok.text },
  neutral: { dot: tone.neutral.dot, text: tone.neutral.text },
};

function sectionTone(activity: CardActivityTone): CardSectionTone | undefined {
  return activity === 'neutral' ? undefined : activity;
}

function progressTone(activity: CardActivityTone): ProgressTone {
  return activity === 'neutral' ? 'claude' : activity;
}

/** Spacing read off artboards 1 and 6: 8 px from the id row to the title, 10 px between activity rows. */
const styles = StyleSheet.create({
  target: {
    borderRadius: radius.card,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  localId: {
    alignSelf: 'flex-start',
    flexShrink: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.chip,
    backgroundColor: tone.neutral.band,
  },
  adoId: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  title: {
    marginTop: space.sm,
  },
  design: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    // Centred on the first 16 px line of the activity text.
    marginTop: 6,
    flexShrink: 0,
  },
  activityText: {
    flex: 1,
  },
  bar: {
    marginTop: 10,
  },
  neutralWash: {
    backgroundColor: color.bg,
  },
  neutralBar: {
    backgroundColor: color.line,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: 10,
  },
  model: {
    flexShrink: 1,
  },
});
