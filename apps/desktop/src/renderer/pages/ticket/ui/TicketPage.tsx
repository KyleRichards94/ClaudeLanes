import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { TicketRecord, WorkItem } from '@agent-lanes/contracts';
import { color, radius, shadow, space } from '@agent-lanes/tokens';
import { Button, TabPanel, Text } from '@agent-lanes/ui';
import { WorkItemChip } from '@/entities/ado-work-item';
import { agentTickets, ticketFromRecord, useAgentTicket, useSetGate, type AgentTicket } from '@/entities/agent-ticket';
import { BuildLog } from '@/entities/build-log';
import { GateActions } from '@/features/resolve-gate';
import { PermissionPrompt } from '@/features/resolve-permission';
import { useAgentUsage, useTicketRecord, useWorkItem } from '@/shared/api';
import { useTicketPageTab, type TicketPageTab } from '@/shared/model';
import { routes, useNavigation } from '@/shared/routing';
import { ErrorBoundary, TicketTabBar } from '@/shared/ui';
import { sessionStartedAt, stageSteps } from '../lib/stage-steps';
import { StageStepper } from './StageStepper';
import { TicketMeta, TicketTopBar } from './TicketHeader';
import { AgentPanel, MergePanel, SubAgentsPanel, SubBranchesPanel, WorktreePanel } from './TicketPanels';

export interface TicketPageProps {
  ticketId: string;
}

/** Below this window width the sub-agent column moves under the output (AL-170). */
export const SIDE_COLUMN_BREAKPOINT = 1200;
const TABS_ID = 'ticket-tabs';

/**
 * Route `ticket/:id`, the ticket drill-in (artboard 3): top bar, meta chips, title, stage stepper,
 * the Agent / Worktree / Merge panels, the tab bar with its panels, and the right column with the
 * sub-agents and sub-branches. Live fields come from the agent ticket store; fields only the record
 * keeps (session id, sub-branches) come from `tickets:get`. A ticket the store has not loaded yet is
 * added to it from its record.
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
  const { width } = useWindowDimensions();
  const wide = width >= SIDE_COLUMN_BREAKPOINT;
  const tab = useTicketPageTab(ticket.id);
  const workItem = useWorkItem(ticket.ado?.workItemId);
  const now = useNow(60_000);
  const history = record?.stageHistory ?? [{ stage: ticket.stage, at: ticket.stageEnteredAt }];
  const subBranches = record?.subBranches ?? [];
  const usage = useAgentUsage(ticket.id).data;
  const setGate = useSetGate();

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page} testID="ticket-page">
      <ErrorBoundary name="ticket:top-bar" label="the top bar">
        <TicketTopBar
          ticketId={ticket.id}
          repo={ticket.repo}
          session={{ id: record?.sessionId ?? null, startedAt: sessionStartedAt(history), now, usage }}
        />
      </ErrorBoundary>

      <View style={styles.heading}>
        <TicketMeta
          ticketId={ticket.id}
          workItem={workItem.data}
          note={ticket.ado === null ? 'No Azure DevOps work item' : workItem.isError ? 'Azure DevOps details unavailable' : undefined}
        />
        <Text variant="display" role="heading" aria-level={1} selectable testID="ticket-title">
          {ticket.title || `#${ticket.id}`}
        </Text>
      </View>

      <ErrorBoundary name="ticket:stepper" label="the stage stepper">
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
      </ErrorBoundary>

      {/* A tool call outside the permission policy waits for the user (AL-109). */}
      <PermissionPrompt ticketId={ticket.id} />

      <View style={styles.panels}>
        <AgentPanel ticket={ticket} />
        <WorktreePanel ticket={ticket} />
        <MergePanel ticket={ticket} subBranches={subBranches} />
      </View>

      <TicketTabBar ticketId={ticket.id} value={tab} idPrefix={TABS_ID} style={styles.tabs} />
      <View style={[styles.body, wide ? styles.bodyWide : styles.bodyStacked]} testID={wide ? 'ticket-body-wide' : 'ticket-body-stacked'}>
        <TabPanel idPrefix={TABS_ID} value={tab} style={[styles.tabPanel, wide && styles.tabPanelWide]} testID="ticket-tab-panel">
          <ErrorBoundary key={tab} name={`ticket:tab:${tab}`} label={`the ${TAB_TITLES[tab]} tab`}>
            {tab === 'build-log' ? (
              <BuildLog ticketId={ticket.id} style={styles.buildLog} />
            ) : (
              <TabPlaceholder tab={tab} ticket={ticket} workItem={workItem.data} />
            )}
          </ErrorBoundary>
        </TabPanel>
        <View style={[styles.side, wide ? styles.sideWide : null]} testID="ticket-side-column">
          <SubAgentsPanel ticket={ticket} leadTokens={usage?.leadTokens} />
          <SubBranchesPanel ticket={ticket} subBranches={subBranches} />
        </View>
      </View>
    </ScrollView>
  );
}

const TAB_TITLES: Record<TicketPageTab, string> = { output: 'Output', diff: 'Diff', 'build-log': 'Build log', ado: 'ADO' };

const TAB_EMPTY: Record<TicketPageTab, string> = {
  output: "The agent's output streams here: tool calls, its notes and the line it is writing now.",
  diff: "Changes on this ticket's branch against its base, file by file.",
  'build-log': "The worktree's latest build and run log.",
  ado: 'The work item, its acceptance criteria, comments and linked pull request.',
};

/** What each tab shows until its feature lands (AL-175, AL-179, AL-180). The Build log tab is AL-135's BuildLog. */
function TabPlaceholder({ tab, ticket, workItem }: { tab: TicketPageTab; ticket: AgentTicket; workItem: WorkItem | undefined }) {
  const activity = tab === 'output' ? ticket.activity?.text : undefined;
  return (
    <View style={styles.placeholder} testID={`ticket-tab-${tab}`}>
      <Text variant="title" size="lg">
        {TAB_TITLES[tab]}
      </Text>
      {/* The work item from Azure DevOps (AL-066) until AL-180 builds the ADO tab. */}
      {tab === 'ado' && workItem ? <WorkItemChip item={workItem} testID="ticket-work-item" /> : null}
      {activity ? (
        <Text variant="body" color={color.claudeText}>
          {activity}
        </Text>
      ) : null}
      <Text variant="meta" size="md">
        {TAB_EMPTY[tab]}
      </Text>
    </View>
  );
}

function MissingTicket({ ticketId, state, onRetry }: { ticketId: string; state: 'loading' | 'error' | 'missing'; onRetry: () => void }) {
  const { navigate } = useNavigation();
  return (
    <View style={[styles.scroll, styles.page]} testID="ticket-page">
      <TicketTopBar ticketId={ticketId} />
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

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  page: {
    padding: space.xl,
    gap: space.xl,
  },
  heading: {
    gap: space.md,
  },
  panels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  body: {
    gap: space.lg,
  },
  bodyWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bodyStacked: {
    flexDirection: 'column',
  },
  tabs: {
    alignSelf: 'flex-start',
    // The tab bar sits close over the output card (artboard 3).
    marginBottom: -space.sm,
  },
  tabPanel: {
    minHeight: 480,
    padding: space.xl,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
  },
  tabPanelWide: {
    flex: 1,
    minWidth: 0,
  },
  placeholder: {
    gap: space.sm,
  },
  // The log virtualises its rows, so it needs a bounded height inside the page's scroll view (AL-135).
  // Its own style is `flex: 1`, whose 0% basis would let it grow to every row here; a fixed basis wins.
  buildLog: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 560,
    height: 560,
  },
  side: {
    gap: space.lg,
  },
  sideWide: {
    width: 400,
  },
  missing: {
    gap: space.md,
    alignItems: 'flex-start',
  },
  missingAction: {
    marginTop: space.sm,
  },
});
