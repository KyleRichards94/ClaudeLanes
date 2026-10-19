import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import type { AgentView } from '@/entities/agent';
import { agentById } from '@/entities/agent';
import { OutputStream, type OutputStreamProps, type TurnHeader } from '@/entities/agent-output';
import { toolCountsLabel, type Turn } from '@/entities/turn';
import { UNKNOWN_AGENT_COLOR } from '@/shared/config';
import { usePrefersReducedMotion } from '@/shared/lib';
import { PanelErrorBoundary } from '@/shared/ui';
import { formatCost, formatTurnDuration } from '../lib/format';
import { LIVE_TURN_FILL } from '../model/turn-strip';
import { pulseStyle, web } from './motion';

export interface GroupedOutputProps {
  /** The agent whose output the column shows (the lead, or a second agent). */
  ticketId: string;
  /** That agent's turns, for the summary rows. */
  turns: readonly Turn[];
  agents: readonly AgentView[];
  /** The highlighted turn (`selectedTurn`). */
  selectedTurn: number | null;
  /** The rest of what the stream takes: the permission prompt at the waiting row, user message actions, thinking. */
  stream?: Omit<OutputStreamProps, 'ticketId' | 'grouping' | 'style' | 'testID'>;
  /** The composer, pinned to the bottom of the column. */
  composer: ReactNode;
}

/** The turn-summary row's live dot, in the running indigo. */
const LIVE_DOT = '#818CF8';

/**
 * The output column (handoff "Flight deck > Output column"): the agent's stream with each finished turn collapsed
 * to one row (a 6 px bar in the colour of the agent that led it, its first summary sentence, "Turn 3 · 4m 12s ·
 * $0.42", and a chip with its top two tools) that opens to the whole transcript on a click. The live turn is
 * always open under a pulsing dot. The composer closes the card. The stream is the one the Output tab always had:
 * the same rows, the same permission prompt at the waiting tool, the same Rewind and Fork actions.
 */
export function GroupedOutput({ ticketId, turns, agents, selectedTurn, stream, composer }: GroupedOutputProps) {
  return (
    <View style={styles.column} testID="output-column">
      <PanelErrorBoundary panel="output" ticketId={ticketId}>
        <OutputStream
          key={ticketId}
          ticketId={ticketId}
          style={styles.output}
          testID="ticket-tab-output"
          {...stream}
          grouping={{
            renderHeader: (header) => <TurnRow header={header} turn={turns.find((candidate) => candidate.index === header.index)} agents={agents} selected={selectedTurn === header.index} />,
          }}
        />
      </PanelErrorBoundary>
      {composer}
    </View>
  );
}

function TurnRow({ header, turn, agents, selected }: { header: TurnHeader; turn: Turn | undefined; agents: readonly AgentView[]; selected: boolean }) {
  const reduced = usePrefersReducedMotion();
  const agent = turn ? agentById(agents, turn.leadAgentId) : undefined;
  const bar = header.live ? color.claude : (agent?.color ?? UNKNOWN_AGENT_COLOR);
  const summary = turn?.summary || (header.live ? 'Working…' : 'No summary');
  const tools = turn ? toolCountsLabel(turn.toolCounts) : '';
  const meta = turn
    ? header.live
      ? `Turn ${header.index} · live · ${formatTurnDuration(turn.durationMs)}`
      : `Turn ${header.index} · ${formatTurnDuration(turn.durationMs)} · ${formatCost(turn.costUsd)}`
    : `Turn ${header.index}`;
  const led = agent ? ` led by ${agent.name}` : '';

  const body = (
    <>
      <View style={[styles.bar, header.live ? web({ backgroundImage: LIVE_TURN_FILL }) : { backgroundColor: bar }]} aria-hidden />
      <View style={styles.text}>
        <Text variant="title" size="md" numberOfLines={header.expanded ? 1 : 2} style={styles.summary}>
          {summary}
        </Text>
        <View style={styles.metaRow}>
          {header.live ? <View style={[styles.dot, reduced ? null : pulseStyle]} aria-hidden testID="turn-live-dot" /> : null}
          <Text variant="meta" size="sm" style={styles.meta}>
            {meta}
          </Text>
          {tools ? (
            <View style={styles.chip}>
              <Text variant="mono" size="xs" color={tone.neutral.text} numberOfLines={1}>
                {tools}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {header.live ? null : <Icon name={header.expanded ? 'chevron-up' : 'chevron-down'} size={16} color={color.muted} />}
    </>
  );

  if (header.live) {
    return (
      <View role="group" aria-label={`Turn ${header.index}, running${led}`} style={[styles.row, selected && styles.rowSelected]} testID={`turn-row-${header.index}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      role="button"
      aria-expanded={header.expanded}
      aria-label={`Turn ${header.index}${led}, ${summary}. ${meta}${tools ? `, ${tools}` : ''}`}
      onPress={header.toggle}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
      testID={`turn-row-${header.index}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
  },
  output: {
    flex: 1,
    minHeight: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingRight: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    overflow: 'hidden',
  },
  rowSelected: {
    borderColor: color.claude,
    backgroundColor: color.claudeTint,
  },
  pressed: {
    opacity: 0.85,
  },
  bar: {
    alignSelf: 'stretch',
    width: 6,
    borderRadius: 3,
    marginLeft: space.sm,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  summary: {
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  meta: {
    flexShrink: 0,
  },
  chip: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.chip,
    backgroundColor: tone.neutral.band,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: LIVE_DOT,
  },
});
