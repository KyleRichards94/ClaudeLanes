import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { GlassPanel, Pill, Text, type PillTone } from '@agent-lanes/ui';
import type { AgentView } from '@/entities/agent';
import { usePrefersReducedMotion } from '@/shared/lib';
import { ErrorBoundary } from '@/shared/ui';
import { compactTokens, initialOf, readableOn } from '../lib/format';
import { DONUT_COLORS, DONUT_ORDER, DONUT_SIZE, DONUT_WORDS, donutSegments, stateCounts, tokenShare } from '../model/donut';
import { DonutRing } from './DonutRing';

/** The status pill of an agent row: its words and tone. */
export interface AgentStatusPill {
  readonly label: string;
  readonly tone: PillTone;
}

export interface AgentDonutProps {
  agents: readonly AgentView[];
  /** Muted lines under an agent's name, by id: its model and effort, its branch, what it was asked. */
  lines?: Readonly<Record<string, readonly string[]>>;
  /** A status pill other than the default for an agent's status ("Queued" for a sub-agent still waiting for its stage). */
  statuses?: Readonly<Record<string, AgentStatusPill>>;
  /** At the right of the heading: "2 running · 1 done". */
  counts?: string;
  /** The ticket's sub-branches ready to merge, for the legend. */
  subBranchesReady: number;
  /** The agent whose output the page shows: its row is highlighted. */
  activeId?: string;
  /** A row was pressed: the page opens that agent (a sub-agent's row in the stream, a second agent's output). */
  onOpenAgent?(agent: AgentView): void;
  /** Buttons at the end of an agent's row (Stop, Open, Remove). */
  renderActions?(agent: AgentView): ReactNode;
  /** An agent row's test id. */
  rowTestID?(agent: AgentView): string;
  /** Under the rows: a note about the rows (the tree could not be loaded). */
  notice?: ReactNode;
  /** Under the rows: Assign new agent, Add agent. */
  footer?: ReactNode;
}

const DEFAULT_STATUS: Readonly<Record<AgentView['status'], AgentStatusPill>> = {
  running: { label: 'Running', tone: 'claude' },
  idle: { label: 'Idle', tone: 'neutral' },
  done: { label: 'Done', tone: 'ok' },
  error: { label: 'Failed', tone: 'danger' },
};

const VERBS: Readonly<Record<AgentView['activeKind'], string>> = {
  edit: 'Editing',
  review: 'Reviewing',
  read: 'Reading',
  test: 'Running tests',
  idle: '',
};

/** What a running agent is doing, "Editing FailedSyncFiles.razor"; null when it is on nothing. */
export function activityLine(agent: Pick<AgentView, 'status' | 'activeFile' | 'activeKind'>): string | null {
  if (agent.status !== 'running') return null;
  const verb = VERBS[agent.activeKind];
  if (!verb) return null;
  if (agent.activeKind === 'test') return verb;
  return agent.activeFile ? `${verb} ${agent.activeFile.split('/').at(-1)}` : null;
}

/**
 * The Agents card of the right rail (handoff "Flight deck > Right rail"): an 84 px donut with a segment per agent
 * (the lead violet, a running agent indigo and pulsing, a finished one green) and the total in the middle, a legend
 * with the counts and "{n} sub-branches ready", then a row per agent: its initial on its colour, its name and model,
 * a token bar (its share of the busiest agent's tokens) and a status pill. The page adds the actions of a row and
 * the Assign / Add buttons under the rows.
 */
export function AgentDonut({ agents, lines, statuses, counts, subBranchesReady, activeId, onOpenAgent, renderActions, rowTestID, notice, footer }: AgentDonutProps) {
  const reduced = usePrefersReducedMotion();
  const segments = donutSegments(agents);
  const byState = stateCounts(agents);
  const largest = agents.reduce((max, agent) => Math.max(max, agent.tokens ?? 0), 0);
  return (
    <GlassPanel level="md" style={styles.card} testID="sub-agents-panel">
      <ErrorBoundary name="panel:sub-agents-panel" label="the Agents panel">
        <View style={styles.header}>
          <Text variant="title" role="heading" aria-level={2}>
            Agents
          </Text>
          {counts ? (
            <Text variant="meta" testID="sub-agents-counts">
              {counts}
            </Text>
          ) : null}
        </View>

        <View style={styles.summary} testID="agent-donut">
          <View style={styles.ring}>
            <DonutRing segments={segments} reduced={reduced} />
            <View style={styles.total} pointerEvents="none">
              <Text variant="display" size="xl" style={styles.totalNumber} testID="agent-donut-total">
                {String(agents.length)}
              </Text>
              <Text variant="meta" size="xs">
                {agents.length === 1 ? 'agent' : 'agents'}
              </Text>
            </View>
          </View>
          <View style={styles.legend} testID="agent-donut-legend">
            {DONUT_ORDER.filter((state) => byState[state] > 0).map((state) => (
              <View key={state} style={styles.legendRow}>
                <View style={[styles.swatch, { backgroundColor: DONUT_COLORS[state] }]} aria-hidden />
                <Text variant="body" size="sm" testID={`agent-donut-count-${state}`}>
                  {`${byState[state]} ${DONUT_WORDS[state]}`}
                </Text>
              </View>
            ))}
            <Text variant="meta" size="sm" testID="agent-donut-ready">
              {`${subBranchesReady} ${subBranchesReady === 1 ? 'sub-branch' : 'sub-branches'} ready`}
            </Text>
          </View>
        </View>

        <View role="list" style={styles.rows}>
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              lines={lines?.[agent.id] ?? []}
              status={statuses?.[agent.id] ?? DEFAULT_STATUS[agent.status]}
              share={tokenShare(agent.tokens, largest)}
              active={agent.id === activeId}
              {...(onOpenAgent ? { onOpen: () => onOpenAgent(agent) } : {})}
              actions={renderActions?.(agent)}
              testID={rowTestID?.(agent) ?? `agent-row-${agent.id}`}
            />
          ))}
        </View>
        {notice}
        {footer}
      </ErrorBoundary>
    </GlassPanel>
  );
}

function AgentRow({
  agent,
  lines,
  status,
  share,
  active,
  onOpen,
  actions,
  testID,
}: {
  agent: AgentView;
  lines: readonly string[];
  status: AgentStatusPill;
  share: number | null;
  active: boolean;
  onOpen?: () => void;
  actions: ReactNode;
  testID: string;
}) {
  const doing = activityLine(agent);
  const main = (
    <>
      <View style={[styles.tile, { backgroundColor: agent.color }]} aria-hidden>
        <Text variant="title" size="md" color={readableOn(agent.color)}>
          {initialOf(agent.name)}
        </Text>
      </View>
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <Text variant="title" numberOfLines={1} style={styles.name}>
            {agent.name}
          </Text>
          <Pill label={status.label} tone={status.tone} dot />
        </View>
        {agent.model && lines.length === 0 ? (
          <Text variant="meta" numberOfLines={1}>
            {agent.model}
          </Text>
        ) : null}
        {lines.map((line, index) => (
          <Text key={index} variant="meta" numberOfLines={2}>
            {line}
          </Text>
        ))}
        {doing ? (
          <Text variant="meta" color={color.claudeText} numberOfLines={1}>
            {doing}
          </Text>
        ) : null}
        {agent.tokens !== null && agent.tokens > 0 ? (
          <View style={styles.tokens}>
            <View style={styles.track} aria-hidden>
              <View style={[styles.fill, { width: `${Math.round((share ?? 0) * 100)}%`, backgroundColor: agent.color }]} />
            </View>
            <Text variant="mono" size="xs" color={color.muted} numberOfLines={1} testID={`${testID}-tokens`}>
              {`${compactTokens(agent.tokens)} tokens`}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
  return (
    <View role="listitem" style={[styles.row, active && styles.rowActive]} testID={testID}>
      {onOpen ? (
        <Pressable role="button" aria-label={`${agent.name}, ${status.label}`} onPress={onOpen} style={styles.main}>
          {main}
        </Pressable>
      ) : (
        <View style={styles.main}>{main}</View>
      )}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
    padding: space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  ring: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  total: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalNumber: {
    lineHeight: 24,
  },
  legend: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rows: {
    gap: space.sm,
  },
  row: {
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  rowActive: {
    borderColor: '#8B80E0',
    backgroundColor: color.claudeTint,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  tokens: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: 2,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.xs,
  },
});
