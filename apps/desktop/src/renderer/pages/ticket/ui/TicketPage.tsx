import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions, type KeyDownEvent } from 'react-native';
import type { TicketRecord } from '@agent-lanes/contracts';
import { color, radius, shadow, space } from '@agent-lanes/tokens';
import { Button, TabPanel, Text } from '@agent-lanes/ui';
import { OutputStream } from '@/entities/agent-output';
import { agentTickets, ticketFromRecord, useAgentTicket, useSetGate, type AgentTicket } from '@/entities/agent-ticket';
import { BuildLog } from '@/entities/build-log';
import { AgentMenu } from '@/features/agent-menu';
import { Composer } from '@/features/send-message';
import { GateActions } from '@/features/resolve-gate';
import { PermissionPrompt } from '@/features/resolve-permission';
import { QueuedNotice } from '@/features/start-queued-agent';
import { useAgentUsage, useInterruptTurn, useReconnectSession, useSessionStatus, useTicketRecord, useWorkItem } from '@/shared/api';
import { toast, useTicketPageTab, type TicketPageTab } from '@/shared/model';
import { routes, useNavigation } from '@/shared/routing';
import { ErrorBoundary, PanelErrorBoundary, PlanLimitsPill, TicketTabBar } from '@/shared/ui';
import { sessionStartedAt, stageSteps } from '../lib/stage-steps';
import { CreatePullRequestPanel } from './CreatePullRequestPanel';
import { AdoTab } from './AdoTab';
import { DiffTab } from './DiffTab';
import { StageStepper } from './StageStepper';
import { TicketHeaderBand } from './TicketHeader';
import { UsageStrip } from './UsageStrip';
import { AgentsPanel, MergePanel, SubBranchesPanel, WorktreePanel } from './TicketPanels';

export interface TicketPageProps {
  ticketId: string;
}

/** Below this window width the rail moves under the transcript and the page scrolls as a whole (AL-170, AL-250). */
export const SIDE_COLUMN_BREAKPOINT = 1200;
/** The rail's width beside the transcript (artboard 3). */
export const RAIL_WIDTH = 400;
/** The transcript's height when the page scrolls as a whole: the window less the bands, never under this. */
export const STACKED_PANEL_MIN_HEIGHT = 480;
const STACKED_PANEL_CHROME = 200;
const TABS_ID = 'ticket-tabs';

/**
 * Route `ticket/:id`, the ticket drill-in (AL-250, artboard 3 reshaped for an output-first page): a
 * header band (breadcrumb, work item chip, title, session pill, agent controls), the stage stepper on
 * a band under it, then the tab bar and its panel filling the rest of the window with the composer
 * pinned to its bottom, and the rail (Worktree, Merge, Agents, Sub-branches) on the right. Below
 * 1200 px the rail stacks under the panel and the page scrolls.
 *
 * Live fields come from the agent ticket store; fields only the record keeps (session id,
 * sub-branches) come from `tickets:get`. A ticket the store has not loaded yet is added to it from
 * its record.
 */
export function TicketPage({ ticketId }: TicketPageProps) {
  const live = useAgentTicket(ticketId);
  const recordQuery = useTicketRecord(ticketId);
  const record = recordQuery.data ?? undefined;

  useEffect(() => {
    if (record && !agentTickets.getState().byId.has(record.id)) agentTickets.upsert(record);
  }, [record]);

  const ticket = live ?? (record ? ticketFromRecord(record) : undefined);

  if (!ticket) {
    return (
      <MissingTicket
        ticketId={ticketId}
        state={recordQuery.isPending ? 'loading' : recordQuery.isError ? 'error' : 'missing'}
        onRetry={() => void recordQuery.refetch()}
      />
    );
  }
  return <TicketFrame ticket={ticket} record={record} />;
}

function TicketFrame({ ticket, record }: { ticket: AgentTicket; record: TicketRecord | undefined }) {
  const { width, height } = useWindowDimensions();
  const wide = width >= SIDE_COLUMN_BREAKPOINT;
  const tab = useTicketPageTab(ticket.id);
  const workItem = useWorkItem(ticket.ado?.workItemId);
  const now = useNow(60_000);
  const history = record?.stageHistory ?? [{ stage: ticket.stage, at: ticket.stageEnteredAt }];
  const subBranches = record?.subBranches ?? [];
  const usage = useAgentUsage(ticket.id).data;
  const status = useSessionStatus(ticket.id).data;
  const reconnect = useReconnectSession(ticket.id);
  const interrupt = useInterruptTurn(ticket.id);
  const setGate = useSetGate();

  // Esc stops the running turn, as in Claude Code (AL-253); a menu or modal that is open takes Esc first.
  const onKeyDown = (event: KeyDownEvent) => {
    if (event.nativeEvent.key !== 'Escape' || status?.state !== 'running' || interrupt.isPending) return;
    interrupt.mutate();
  };

  const header = (
    <ErrorBoundary name="ticket:top-bar" label="the header">
      <TicketHeaderBand
        ticketId={ticket.id}
        title={ticket.title}
        repo={ticket.repo}
        workItem={workItem.data}
        note={ticket.ado === null ? 'No Azure DevOps work item' : workItem.isError ? 'Azure DevOps details unavailable' : undefined}
        session={{
          id: status?.sessionId ?? record?.sessionId ?? null,
          startedAt: sessionStartedAt(history),
          now,
          usage,
          status,
          onReconnect: () => reconnect.mutate(undefined, { onError: (error) => toast({ id: `reconnect:${ticket.id}`, tone: 'error', title: "Couldn't reconnect", body: error.message }) }),
          reconnecting: reconnect.isPending,
        }}
        trailing={
          <>
            <PlanLimitsPill testID="ticket-plan-limits" />
            <UsageStrip usage={usage} />
            <AgentMenu ticketId={ticket.id} />
          </>
        }
      />
    </ErrorBoundary>
  );

  const stepper = (
    <ErrorBoundary name="ticket:stepper" label="the stage stepper">
      <View style={styles.stepperBand} testID="ticket-stepper-band">
        <StageStepper
          steps={stageSteps(ticket.stage, history)}
          progress={ticket.progress}
          gates={ticket.gates}
          onGateChange={(stage, gate) => setGate.mutate({ ticketId: ticket.id, stage, gate })}
          waitingStage={ticket.gate?.stage ?? null}
          gateActions={<GateActions ticketId={ticket.id} placement="stepper" />}
        />
        {setGate.error ? (
          <Text variant="body" size="sm" color={color.danger} role="alert">
            {`The gate couldn't be changed: ${setGate.error.message}`}
          </Text>
        ) : null}
        {/* A tool call outside the permission policy waits for the user (AL-109). */}
        <PermissionPrompt ticketId={ticket.id} />
        {/* Waiting for a free slot in its repo, with Start now (AL-111). */}
        <QueuedNotice ticketId={ticket.id} />
      </View>
    </ErrorBoundary>
  );

  const panel = (
    <TabPanel idPrefix={TABS_ID} value={tab} style={[styles.tabPanel, wide ? styles.tabPanelWide : stackedPanel(height)]} testID="ticket-tab-panel">
      <ErrorBoundary key={tab} name={`ticket:tab:${tab}`} label={`the ${TAB_TITLES[tab]} tab`}>
        {tab === 'build-log' ? (
          <BuildLog ticketId={ticket.id} style={styles.buildLog} />
        ) : tab === 'output' ? (
          <>
            <PanelErrorBoundary panel="output" ticketId={ticket.id}>
              <OutputStream ticketId={ticket.id} style={styles.output} testID="ticket-tab-output" />
            </PanelErrorBoundary>
            {/* Skills, message box, Pause / Resume and Send under the stream (AL-176). */}
            <Composer ticketId={ticket.id} skills={record?.skills ?? []} switching={ticket.switching !== null} style={styles.composer} />
          </>
        ) : (
          <ScrollView style={styles.tabScroll} contentContainerStyle={styles.tabContent}>
            {tab === 'diff' ? <DiffTab ticketId={ticket.id} branch={ticket.branch} subBranches={subBranches} /> : <AdoTab ticket={ticket} />}
          </ScrollView>
        )}
      </ErrorBoundary>
    </TabPanel>
  );

  const main = (
    <View style={[styles.main, wide && styles.mainWide]}>
      <TicketTabBar ticketId={ticket.id} value={tab} idPrefix={TABS_ID} style={styles.tabs} />
      {panel}
    </View>
  );

  const rail = (
    <View style={styles.railCards} testID={wide ? undefined : 'ticket-side-column'}>
      {/* The Create PR stage (AL-181): from entering Create PR, and for as long as the ticket has a PR. */}
      {ticket.stage === 'create-pr' || ticket.pullRequest || record?.pullRequest ? <CreatePullRequestPanel ticket={ticket} saved={record?.pullRequest} /> : null}
      <WorktreePanel ticket={ticket} />
      <MergePanel ticket={ticket} />
      <AgentsPanel ticket={ticket} leadTokens={usage?.leadTokens} />
      <SubBranchesPanel ticket={ticket} subBranches={subBranches} />
    </View>
  );

  if (wide) {
    return (
      <View style={styles.page} onKeyDown={onKeyDown} testID="ticket-page">
        {header}
        {stepper}
        <View style={styles.bodyWide} testID="ticket-body-wide">
          {main}
          <ScrollView style={styles.rail} contentContainerStyle={styles.railContent} testID="ticket-side-column">
            {rail}
          </ScrollView>
        </View>
      </View>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.pageStacked} onKeyDown={onKeyDown} testID="ticket-page">
      {header}
      {stepper}
      <View style={styles.bodyStacked} testID="ticket-body-stacked">
        {main}
        {rail}
      </View>
    </ScrollView>
  );
}

/** The tab panel's height when the page scrolls as a whole (below 1200 px): most of the window. */
export function stackedPanelHeight(windowHeight: number): number {
  return Math.max(STACKED_PANEL_MIN_HEIGHT, Math.round(windowHeight) - STACKED_PANEL_CHROME);
}

// A fixed basis, not `flex: 1`: inside the scrolling page a 0% basis would collapse the panel to its content.
function stackedPanel(windowHeight: number) {
  const height = stackedPanelHeight(windowHeight);
  return { height, flexBasis: height, flexGrow: 0, flexShrink: 0 };
}

const TAB_TITLES: Record<TicketPageTab, string> = { output: 'Output', diff: 'Diff', 'build-log': 'Build log', ado: 'ADO' };

function MissingTicket({ ticketId, state, onRetry }: { ticketId: string; state: 'loading' | 'error' | 'missing'; onRetry: () => void }) {
  const { navigate } = useNavigation();
  return (
    <View style={[styles.page, styles.pageStacked]} testID="ticket-page">
      <TicketHeaderBand ticketId={ticketId} />
      <View style={styles.missing} aria-busy={state === 'loading'}>
        <Text variant="display" size="xl" role="heading" aria-level={1}>
          {`#${ticketId}`}
        </Text>
        <Text variant="meta" size="md" testID="ticket-missing">
          {state === 'loading'
            ? 'Loading the ticket…'
            : state === 'error'
              ? "Couldn't load this ticket."
              : "This ticket isn't on the board. It may have been archived."}
        </Text>
        {state === 'error' ? (
          <Button label="Retry" onPress={onRetry} style={styles.missingAction} />
        ) : state === 'missing' ? (
          <Button label="Back to the board" onPress={() => navigate(routes.board())} style={styles.missingAction} />
        ) : null}
      </View>
    </View>
  );
}

/** The time now, refreshed every `intervalMs` (the session pill's running time). */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Everything a child needs to fill the window: a flex column whose children can shrink. */
function column(): { flex: number; minHeight: number } {
  return { flex: 1, minHeight: 0 };
}


const styles = StyleSheet.create({
  page: {
    ...column(),
    padding: space.lg,
    gap: space.md,
  },
  scroll: {
    flex: 1,
  },
  pageStacked: {
    padding: space.lg,
    gap: space.md,
  },
  stepperBand: {
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  bodyWide: {
    ...column(),
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.lg,
  },
  bodyStacked: {
    gap: space.lg,
  },
  main: {
    minWidth: 0,
  },
  mainWide: {
    ...column(),
    flexShrink: 1,
  },
  tabs: {
    alignSelf: 'flex-start',
    // The tab bar sits close over the output card (artboard 3).
    marginBottom: -space.sm,
  },
  tabPanel: {
    overflow: 'hidden',
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
  },
  tabPanelWide: {
    ...column(),
  },
  tabScroll: {
    flex: 1,
  },
  tabContent: {
    padding: space.xl,
  },
  // The log and the stream virtualise their rows (AL-135, AL-175): they take the panel's height.
  buildLog: {
    flex: 1,
    minHeight: 0,
    borderWidth: 0,
    borderRadius: 0,
    boxShadow: 'none',
  },
  output: {
    flex: 1,
    minHeight: 0,
  },
  // The composer closes the card (artboard 3 footer).
  composer: {
    borderBottomLeftRadius: radius.panel,
    borderBottomRightRadius: radius.panel,
  },
  rail: {
    width: RAIL_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  railContent: {
    paddingBottom: space.lg,
  },
  railCards: {
    gap: space.lg,
  },
  missing: {
    gap: space.md,
    alignItems: 'flex-start',
  },
  missingAction: {
    marginTop: space.sm,
  },
});
