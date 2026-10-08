import { StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import {
  Card,
  CardSection,
  IdChip,
  ProgressBar,
  StatusBadge,
  Text,
  Toast,
  badgeStatuses,
  type CardFooter,
  type CardSectionTone,
  type CardTone,
  type ProgressTone,
} from '@agent-lanes/ui';
import { BuildRunControlsView, type BuildRunControlsViewProps } from '@/features/build-run';
import { ModelEffortControlsView, type ModelEffortControlsViewProps } from '@/features/change-model';
import { GalleryBlock, GalleryRow, GallerySheet } from './GallerySection';

/** The drill-in's Worktree panel in its build and run states (AL-173), with no actions behind it. */
const worktreeStates: readonly { state: string; ticket: BuildRunControlsViewProps['ticket'] }[] = [
  {
    state: 'Idle · last build succeeded',
    ticket: {
      build: { job: null, last: { outcome: 'succeeded', startedAt: 0, finishedAt: new Date(2026, 9, 7, 14, 2).getTime(), errors: 0, warnings: 0 } },
      run: { state: 'stopped', url: null, startedAt: null },
    },
  },
  {
    state: 'Build queued',
    ticket: { build: { job: { jobId: 'job-2', kind: 'build', state: 'queued', position: 2 }, last: null }, run: { state: 'stopped', url: null, startedAt: null } },
  },
  {
    state: 'Running',
    ticket: { build: { job: null, last: null }, run: { state: 'running', url: 'http://localhost:5080/', startedAt: 0 } },
  },
];
const ignore = () => undefined;

/** The drill-in's Agent panel steady and while a model change waits for the next turn (AL-172). */
const agentStates: readonly { state: string; ticket: ModelEffortControlsViewProps['ticket'] }[] = [
  { state: 'Opus · XHigh', ticket: { id: 'gallery', model: 'opus', effort: 'xhigh', stage: 'implementing', switching: null } },
  {
    state: 'Switching',
    ticket: { id: 'gallery', model: 'opus', effort: 'xhigh', stage: 'implementing', switching: { model: 'sonnet', effort: 'high', requestedAt: 0 } },
  },
];

/** One card on artboard 6. Built from the primitives; the board's own card is AL-144's AgentTicketCard. */
interface CardState {
  state: string;
  tone: CardTone;
  adoState: string;
  activity: string;
  activityTone: CardSectionTone;
  progress: number;
  progressTone: ProgressTone;
  model: string;
  subAgents: string;
  footer?: CardFooter;
}

const title = 'Cutover frmJobControl to Blazor';

/** Every card state on "Agent card states" (docs/design/screens/06-card-states.png), in its order. */
export const cardStates: readonly CardState[] = [
  { state: 'Running', tone: 'default', adoState: 'Active', activity: 'Editing JobControl.razor', activityTone: 'claude', progress: 0.46, progressTone: 'claude', model: 'Opus · XHigh', subAgents: '3 sub-agents' },
  { state: 'Selected', tone: 'selected', adoState: 'Active', activity: 'Editing JobControl.razor', activityTone: 'claude', progress: 0.46, progressTone: 'claude', model: 'Opus · XHigh', subAgents: '3 sub-agents' },
  {
    state: 'Needs approval',
    tone: 'attention',
    adoState: 'Active',
    activity: 'Plan ready for review',
    activityTone: 'claude',
    progress: 1,
    progressTone: 'claude',
    model: 'Opus · XHigh',
    subAgents: '3 sub-agents',
    footer: { tone: 'attention', label: 'Needs you · approve plan' },
  },
  {
    state: 'Model switching',
    tone: 'default',
    adoState: 'Active',
    activity: 'Finishing current turn',
    activityTone: 'claude',
    progress: 0.46,
    progressTone: 'claude',
    model: 'Opus → Sonnet · High',
    subAgents: '3 sub-agents',
    footer: { tone: 'ado', label: 'Switching · applies next turn' },
  },
  {
    state: 'Build failed',
    tone: 'danger',
    adoState: 'Active',
    activity: 'CS0246: JobFilterState not found',
    activityTone: 'danger',
    progress: 0.46,
    progressTone: 'danger',
    model: 'Opus · XHigh',
    subAgents: '3 sub-agents',
    footer: { tone: 'danger', label: 'Build failed · 3 errors' },
  },
  {
    state: 'QA gap',
    tone: 'attention',
    adoState: 'Resolved',
    activity: 'cs-qa-wip: 4 / 5 criteria pass',
    activityTone: 'claude',
    progress: 0.84,
    progressTone: 'claude',
    model: 'Opus · XHigh',
    subAgents: '3 sub-agents',
    footer: { tone: 'attention', label: 'Needs you · 1 gap' },
  },
  { state: 'PR open', tone: 'default', adoState: 'Resolved', activity: 'PR !10612 · 3 / 4 checks', activityTone: 'ado', progress: 0.94, progressTone: 'ado', model: 'Opus · XHigh', subAgents: '3 sub-agents' },
  { state: 'Merged', tone: 'muted', adoState: 'Closed', activity: 'Merged into main · 15:20', activityTone: 'ok', progress: 1, progressTone: 'ok', model: 'Opus · XHigh', subAgents: '—' },
];

/** Activity text and dot colour per section tint (violet Claude, blue ADO, red, green). */
const activityInk: Record<CardSectionTone, { text: string; dot: string }> = {
  claude: { text: tone.claude.text, dot: tone.claude.dot },
  ado: { text: tone.ado.text, dot: tone.ado.dot },
  danger: { text: tone.danger.text, dot: tone.danger.dot },
  ok: { text: tone.ok.text, dot: tone.ok.dot },
};

function slug(state: string): string {
  return state.toLowerCase().replace(/\s+/g, '-');
}

function CardStateSample({ card }: { card: CardState }) {
  const ink = activityInk[card.activityTone];
  return (
    <Card tone={card.tone} footer={card.footer} style={styles.card} testID={`gallery-card-${slug(card.state)}`}>
      <CardSection style={styles.cardHead}>
        <View style={styles.idRow}>
          <IdChip id={71273} />
          <Text variant="meta">{card.adoState}</Text>
        </View>
        <Text variant="title">{title}</Text>
      </CardSection>
      <CardSection tone={card.activityTone} style={styles.activity}>
        <View style={styles.activityRow}>
          <View aria-hidden style={[styles.dot, { backgroundColor: ink.dot }]} />
          <Text variant="body" size="sm" color={ink.text} numberOfLines={1}>
            {card.activity}
          </Text>
        </View>
        <ProgressBar progress={card.progress} tone={card.progressTone} label={`${card.state} progress`} />
        <View style={styles.metaRow}>
          <Text variant="meta">{card.model}</Text>
          <Text variant="meta">{card.subAgents}</Text>
        </View>
      </CardSection>
    </Card>
  );
}

/** Artboard 6, "Agent card states": every card state, an empty lane, an error toast and the status badges. */
export function CardStatesSheet() {
  return (
    <GallerySheet kicker="Component sheet" title="Agent card states" testID="gallery-card-states">
      <GalleryRow style={styles.cards}>
        {cardStates.map((card) => (
          <GalleryBlock key={card.state} title={card.state} style={styles.cardBlock}>
            <CardStateSample card={card} />
          </GalleryBlock>
        ))}
      </GalleryRow>

      <GalleryRow style={styles.cards}>
        <GalleryBlock title="Empty lane" style={styles.wideBlock}>
          <View style={styles.emptyLane} testID="gallery-empty-lane">
            <Text variant="title" size="lg">
              Nothing in QA
            </Text>
            <Text variant="meta" size="md">
              Tickets land here once code review passes.
            </Text>
          </View>
        </GalleryBlock>
        <GalleryBlock title="Toast · error" style={styles.wideBlock}>
          <Toast
            tone="error"
            title="MCP bridge lost the session"
            body="cc-71288 stopped responding. The worktree is intact."
            actions={[{ label: 'Reconnect', onPress: () => undefined }]}
            onDismiss={() => undefined}
            testID="gallery-toast-error"
          />
        </GalleryBlock>
        {agentStates.map((sample) => (
          <GalleryBlock key={sample.state} title={`Agent · ${sample.state}`} style={styles.wideBlock}>
            <View style={styles.badgePanel}>
              <ModelEffortControlsView ticket={sample.ticket} onModel={ignore} onEffort={ignore} />
            </View>
          </GalleryBlock>
        ))}
        {worktreeStates.map((sample) => (
          <GalleryBlock key={sample.state} title={`Worktree · ${sample.state}`} style={styles.wideBlock}>
            <View style={styles.badgePanel}>
              <BuildRunControlsView ticket={sample.ticket} onBuild={ignore} onRun={ignore} onStop={ignore} onOpen={ignore} />
            </View>
          </GalleryBlock>
        ))}
        <GalleryBlock title="Status badges" style={styles.wideBlock}>
          <View style={styles.badgePanel}>
            <GalleryRow>
              {badgeStatuses.map((status) => (
                <StatusBadge key={status} status={status} size="md" />
              ))}
            </GalleryRow>
          </View>
        </GalleryBlock>
      </GalleryRow>
    </GallerySheet>
  );
}

const styles = StyleSheet.create({
  cards: {
    alignItems: 'flex-start',
    gap: space.xl,
  },
  cardBlock: {
    width: 260,
  },
  wideBlock: {
    width: 450,
  },
  card: {
    width: 260,
  },
  cardHead: {
    gap: space.sm,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activity: {
    gap: space.sm,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  emptyLane: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    backgroundColor: color.bg,
  },
  badgePanel: {
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
});
