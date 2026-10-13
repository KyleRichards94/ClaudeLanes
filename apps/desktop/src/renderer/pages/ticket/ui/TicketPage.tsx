import { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type KeyDownEvent,
} from "react-native";
import type { TicketRecord } from "@agent-lanes/contracts";
import { color, space } from "@agent-lanes/tokens";
import { Button, SegmentedControl, Text } from "@agent-lanes/ui";
import {
  requestOutputScroll,
  userCaption,
  type WaitingRowState,
} from "@/entities/agent-output";
import {
  agentTickets,
  ticketFromRecord,
  useAgentTicket,
  useSetGate,
  type AgentTicket,
} from "@/entities/agent-ticket";
import { BuildLog } from "@/entities/build-log";
import { AgentMenu } from "@/features/agent-menu";
import { REMOVE_TICKET_KEY, RemoveTicketModal } from "@/features/remove-ticket";
import { MoveStageModal } from "@/features/ticket-actions";
import {
  ASSIGN_AGENT_KEY,
  AddAgentModal,
  AssignAgentModal,
} from "@/features/assign-agent";
import { RewindModal, UserMessageActions } from "@/features/rewind-fork";
import { ModelEffortControls } from "@/features/change-model";
import { Composer } from "@/features/send-message";
import { GateActions } from "@/features/resolve-gate";
import {
  PermissionPrompt,
  usePendingPermission,
} from "@/features/resolve-permission";
import { QueuedNotice } from "@/features/start-queued-agent";
import {
  useAgentUsage,
  useInterruptTurn,
  useReconnectSession,
  useSessionStatus,
  useStopSubagent,
  useTicketRecord,
  useTicketRecords,
  useWorkItem,
} from "@/shared/api";
import {
  clearSelection,
  getTicketView,
  setOutputDiffLayout,
  setTicketPageTab,
  toast,
  useOutputDiffLayout,
  useShowThinking,
  useTicketPageTab,
  useUiPrefs,
  type TicketPageTab,
} from "@/shared/model";
import { LANE_LABELS } from "@/shared/config";
import { routes, useNavigation } from "@/shared/routing";
import {
  ErrorBoundary,
  PlanLimitsPill,
  TicketTabBar,
} from "@/shared/ui";
import { companionLabel, companionsOf } from "../lib/companions";
import { sessionStartedAt } from "../lib/stage-steps";
import { useLayoutShortcut } from "../model/layout-shortcut";
import { useNow } from "../model/use-now";
import { CreatePullRequestPanel } from "./CreatePullRequestPanel";
import { AdoTab } from "./AdoTab";
import { FlightDeckPanel } from "./FlightDeckPanel";
import { LayoutSwitch } from "./LayoutSwitch";
import { TicketHeaderBand } from "./TicketHeader";
import { TicketLayoutSlider } from "./TicketLayoutSlider";
import { UsageStrip } from "./UsageStrip";
import {
  AgentsPanel,
  MergePanel,
  SubBranchesPanel,
  WorktreePanel,
} from "./TicketPanels";

export interface TicketPageProps {
  ticketId: string;
}

/** Below this window width the rail moves under the transcript and the page scrolls as a whole (AL-170, AL-250). */
export const SIDE_COLUMN_BREAKPOINT = 1200;
/** The transcript's height when the page scrolls as a whole: the window less the bands, never under this. */
export const STACKED_PANEL_MIN_HEIGHT = 480;
const STACKED_PANEL_CHROME = 200;
const TABS_ID = "ticket-tabs";
const SHOW_THINKING_KEY = "show-thinking";
const MOVE_STAGE_KEY = "move-stage";
const ADD_AGENT_KEY = "add-agent";
/** One element for the life of the page: the header keeps it across renders, and the slider reads the layout itself. */
const LAYOUT_SLIDER = <TicketLayoutSlider />;

/**
 * Route `ticket/:id`, the ticket drill-in (AL-250, artboard 3 reshaped for an output-first page): a
 * header band (breadcrumb, work item chip, title, layout slider, session pill, agent controls), then
 * `LayoutSwitch` (AL-275), which shows one of two layouts over the same state: Flight deck, or Code City.
 * Flight deck (AL-279, `FlightDeckPanel`): the workflow card with its turn strip, the tab bar, then the grouped
 * output with the composer pinned under it, the change map and diff, and the 330 px rail (Agents, Worktree,
 * Merge, Sub-branches). Below 1200 px the rail stacks under the diff and the page scrolls.
 * This component keeps the state both layouts share (the active agent, modals, the live session) and
 * never reads the layout, so switching it re-renders the layouts and the slider, not the header.
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
    if (record && !agentTickets.getState().byId.has(record.id))
      agentTickets.upsert(record);
  }, [record]);

  // A second agent's id (AL-266) opens its lead's page, switched to that agent.
  if (record?.companion) return <TicketPage ticketId={record.companion.of} />;

  const ticket = live ?? (record ? ticketFromRecord(record) : undefined);

  if (!ticket) {
    return (
      <MissingTicket
        ticketId={ticketId}
        state={
          recordQuery.isPending
            ? "loading"
            : recordQuery.isError
              ? "error"
              : "missing"
        }
        onRetry={() => void recordQuery.refetch()}
      />
    );
  }
  return <TicketFrame ticket={ticket} record={record} />;
}

function TicketFrame({
  ticket,
  record,
}: {
  ticket: AgentTicket;
  record: TicketRecord | undefined;
}) {
  const { width, height } = useWindowDimensions();
  const wide = width >= SIDE_COLUMN_BREAKPOINT;
  useLayoutShortcut();
  const tab = useTicketPageTab(ticket.id);
  const outputDiff = useOutputDiffLayout();
  // Second agents (AL-266): the page shows one agent's output, composer, status and usage at a time; the lead by default.
  const records = useTicketRecords().data;
  const companions = useMemo(
    () => companionsOf(records, ticket.id),
    [records, ticket.id],
  );
  useEffect(() => {
    for (const companion of companions)
      if (!agentTickets.getState().byId.has(companion.id))
        agentTickets.upsert(companion);
  }, [companions]);
  const [agentId, setAgentId] = useState(ticket.id);
  const activeCompanion = companions.find(
    (companion) => companion.id === agentId,
  );
  const activeId = activeCompanion ? agentId : ticket.id;
  const activeLive = useAgentTicket(activeId);
  const active = activeCompanion
    ? (activeLive ?? ticketFromRecord(activeCompanion))
    : ticket;
  const activeRecord = activeCompanion ?? record;
  const [adding, setAdding] = useState(false);
  // The permission prompt sits at the tool row that waits (AL-260); a compact copy stays at the top while that row is scrolled away.
  const pendingPermission = usePendingPermission(active.id);
  const waitingToolUseId = pendingPermission.data?.request?.toolUseId ?? null;
  const [waitingRow, setWaitingRow] = useState<WaitingRowState>("absent");
  const promptAtRow = tab === "output" && waitingRow !== "absent";
  const workItem = useWorkItem(ticket.ado?.workItemId);
  const now = useNow(60_000);
  const history = record?.stageHistory ?? [
    { stage: ticket.stage, at: ticket.stageEnteredAt },
  ];
  const subBranches = record?.subBranches ?? [];
  const usage = useAgentUsage(active.id).data;
  const status = useSessionStatus(active.id).data;
  const reconnect = useReconnectSession(active.id);
  const interrupt = useInterruptTurn(active.id);
  const setGate = useSetGate();
  const { navigate } = useNavigation();
  const [removing, setRemoving] = useState(false);
  const showThinking = useShowThinking();
  const [movingStage, setMovingStage] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // Rewind to here / Fork from here on one of the user's messages (AL-265).
  const [rewindTo, setRewindTo] = useState<{
    messageId: string;
    caption: string;
  } | null>(null);
  const [forkFrom, setForkFrom] = useState<string | null>(null);
  // A sub-agent card opens its output in the stream, or stops it (AL-261).
  const stopSubagent = useStopSubagent(active.id);
  const subAgentActions = {
    onSelect: (node: { id: string }) => {
      setTicketPageTab(ticket.id, "output");
      requestOutputScroll(active.id, node.id);
    },
    onStop: (node: { id: string; name: string }) =>
      stopSubagent.mutate(node.id, {
        onError: (error) =>
          toast({
            id: `stop-subagent:${node.id}`,
            tone: "error",
            title: `Couldn't stop ${node.name}`,
            body: error.message,
          }),
      }),
    stoppingId: stopSubagent.isPending
      ? (stopSubagent.variables ?? null)
      : null,
  };

  // Esc stops the running turn, as in Claude Code (AL-253); a menu or modal that is open takes Esc first. With no
  // turn running it clears the file selection (Flight deck then shows the biggest change again).
  const onKeyDown = (event: KeyDownEvent) => {
    if (event.nativeEvent.key !== "Escape") return;
    if (status?.state === "running") {
      if (!interrupt.isPending) interrupt.mutate();
      return;
    }
    if (getTicketView(ticket.id).selectedFilePath !== null)
      clearSelection(ticket.id);
  };

  const header = (
    <ErrorBoundary name="ticket:top-bar" label="the header">
      <TicketHeaderBand
        ticketId={ticket.id}
        title={ticket.title}
        repo={ticket.repo}
        workItem={workItem.data}
        note={
          ticket.ado === null
            ? "No Azure DevOps work item"
            : workItem.isError
              ? "Azure DevOps details unavailable"
              : undefined
        }
        session={{
          id: status?.sessionId ?? activeRecord?.sessionId ?? null,
          startedAt: activeCompanion
            ? activeCompanion.createdAt
            : sessionStartedAt(history),
          now,
          usage,
          status,
          onReconnect: () =>
            reconnect.mutate(undefined, {
              onError: (error) =>
                toast({
                  id: `reconnect:${active.id}`,
                  tone: "error",
                  title: "Couldn't reconnect",
                  body: error.message,
                }),
            }),
          reconnecting: reconnect.isPending,
          ...(activeCompanion ? {} : { onAssign: () => setAssigning(true) }),
        }}
        layout={LAYOUT_SLIDER}
        trailing={
          <>
            <PlanLimitsPill testID="ticket-plan-limits" />
            <UsageStrip usage={usage} />
            <AgentMenu
              ticketId={active.id}
              extraItems={[
                // Assign new agent (AL-263): ends this agent and starts another in the same worktree.
                {
                  key: ASSIGN_AGENT_KEY,
                  label: "Assign new agent…",
                  detail:
                    "Ends this agent and starts another here, with a hand-over brief or fresh.",
                  icon: "add-agent",
                  section: "Agent",
                },
                // Add agent (AL-266): a second agent beside the lead.
                {
                  key: ADD_AGENT_KEY,
                  label: "Add agent…",
                  detail:
                    "A read-only reviewer in this worktree, or a helper on its own sub-branch.",
                  icon: "add-agent",
                  section: "Agent",
                },
                // Move to stage… (AL-264, AL-270): the user's own lane move; the agent is told at its next turn.
                {
                  key: MOVE_STAGE_KEY,
                  label: "Move to stage…",
                  detail: `Now ${LANE_LABELS[ticket.stage]}`,
                  icon: "branch",
                  section: "Agent",
                },
                {
                  key: SHOW_THINKING_KEY,
                  label: "Show thinking",
                  detail: "The agent's reasoning, collapsed in the output.",
                  icon: "thinking",
                  selected: showThinking,
                  section: "Output",
                },
                {
                  key: REMOVE_TICKET_KEY,
                  label: "Remove from board…",
                  detail:
                    "Ends the agent and removes the worktree; the branch stays.",
                  icon: "archive",
                  danger: true,
                  section: "Ticket",
                },
              ]}
              onExtraSelect={(key) => {
                if (key === REMOVE_TICKET_KEY) setRemoving(true);
                else if (key === SHOW_THINKING_KEY)
                  useUiPrefs.getState().setShowThinking(!showThinking);
                else if (key === MOVE_STAGE_KEY) setMovingStage(true);
                else if (key === ASSIGN_AGENT_KEY) setAssigning(true);
                else if (key === ADD_AGENT_KEY) setAdding(true);
              }}
            />
            <AddAgentModal
              ticketId={ticket.id}
              skills={record?.skills ?? []}
              visible={adding}
              onClose={() => setAdding(false)}
              onAdded={setAgentId}
            />
            <RemoveTicketModal
              ticketId={ticket.id}
              visible={removing}
              onClose={() => setRemoving(false)}
              onRemoved={() => navigate(routes.board())}
            />
            <MoveStageModal
              visible={movingStage}
              ticketId={ticket.id}
              title={ticket.title}
              stage={ticket.stage}
              onClose={() => setMovingStage(false)}
            />
            <AssignAgentModal
              ticketId={ticket.id}
              skills={record?.skills ?? []}
              visible={assigning}
              fork={forkFrom}
              onClose={() => {
                setAssigning(false);
                setForkFrom(null);
              }}
            />
            <RewindModal
              ticketId={ticket.id}
              messageId={rewindTo?.messageId ?? null}
              caption={rewindTo?.caption ?? ""}
              onClose={() => setRewindTo(null)}
            />
          </>
        }
      />
    </ErrorBoundary>
  );

  // What needs the user above the body, inside the workflow card: a failed gate change, a tool call outside the
  // permission policy that waits (AL-109; at its output row when that row is drawn, AL-260), and a queued agent (AL-111).
  const notices = (
    <>
      {setGate.error ? (
        <Text variant="body" size="sm" color={color.danger} role="alert">
          {`The gate couldn't be changed: ${setGate.error.message}`}
        </Text>
      ) : null}
      {promptAtRow && waitingRow === "visible" ? null : (
        <PermissionPrompt
          ticketId={active.id}
          variant={promptAtRow ? "compact" : "banner"}
        />
      )}
      {/* Waiting for a free slot in its repo, with Start now (AL-111). */}
      <QueuedNotice ticketId={active.id} />
    </>
  );

  // The agent switcher (AL-266): Lead, then each second agent, beside the tab bar once there is one.
  const agentOptions = useMemo(
    () => [
      { value: ticket.id, label: "Lead" },
      ...companions.map((companion) => ({
        value: companion.id,
        label: companion.companion
          ? companionLabel(companion.companion)
          : companion.id,
      })),
    ],
    [companions, ticket.id],
  );
  const tabs = (
    <View style={styles.tabsRow}>
      <TicketTabBar
        ticketId={ticket.id}
        value={tab}
        idPrefix={TABS_ID}
        style={styles.tabs}
      />
      {tab === "output" || tab === "diff" ? (
        <Button
          size="sm"
          variant="soft"
          icon={outputDiff.diffShown ? "hide" : "show"}
          label={outputDiff.diffShown ? "Hide diff" : "Show diff"}
          onPress={() =>
            setOutputDiffLayout({ diffShown: !outputDiff.diffShown })
          }
          testID="toggle-diff-pane"
        />
      ) : null}
      {companions.length > 0 ? (
        <SegmentedControl
          label="Agent"
          value={activeId}
          onChange={setAgentId}
          options={agentOptions}
          testID="agent-switcher"
        />
      ) : null}
    </View>
  );

  // The Build log and ADO tabs take the place of the output and diff columns.
  const other = (
    <ErrorBoundary
      key={tab}
      name={`ticket:tab:${tab}`}
      label={`the ${TAB_TITLES[tab]} tab`}
    >
      {tab === "build-log" ? (
        <BuildLog ticketId={ticket.id} style={styles.buildLog} />
      ) : (
        <ScrollView
          style={styles.tabScroll}
          contentContainerStyle={styles.tabContent}
        >
          <AdoTab ticket={ticket} />
        </ScrollView>
      )}
    </ErrorBoundary>
  );

  const rail = (
    <>
      {/* The Create PR stage (AL-181): from entering Create PR, and for as long as the ticket has a PR. */}
      {ticket.stage === "create-pr" ||
      ticket.stage === "pr-only" ||
      ticket.pullRequest ||
      record?.pullRequest ? (
        <CreatePullRequestPanel ticket={ticket} saved={record?.pullRequest} />
      ) : null}
      <AgentsPanel
        actions={subAgentActions}
        ticket={ticket}
        leadTokens={activeCompanion ? undefined : usage?.leadTokens}
        companions={companions}
        activeId={activeId}
        onOpenCompanion={setAgentId}
        footer={
          <View style={styles.agentButtons}>
            <Button
              size="sm"
              variant="secondary"
              icon="add-agent"
              label="Assign new agent"
              onPress={() => setAssigning(true)}
              testID="assign-agent-open"
            />
            {/* Add agent (AL-266): a second agent beside the lead. */}
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              label="Add agent"
              onPress={() => setAdding(true)}
              testID="add-agent-open"
            />
          </View>
        }
      />
      <WorktreePanel ticket={ticket} />
      <MergePanel ticket={ticket} />
      <SubBranchesPanel ticket={ticket} subBranches={subBranches} />
    </>
  );

  // Flight deck is wired by `FlightDeckPanel`; Code City, and the swap between them, are `LayoutSwitch`'s.
  const body = (
    <LayoutSwitch
      stacked={!wide}
      codeCity={{
        ticket,
        companions,
        history,
        composer: (
          <Composer
            key={active.id}
            ticketId={active.id}
            repo={ticket.repo}
            skills={activeRecord?.skills ?? []}
            switching={active.switching !== null}
            tools={<ModelEffortControls ticket={active} compact />}
          />
        ),
        worktree: (
          <View style={styles.railCards}>
            <WorktreePanel ticket={ticket} />
            <MergePanel ticket={ticket} />
          </View>
        ),
      }}
      flightDeck={
        <FlightDeckPanel
          ticket={ticket}
          companions={companions}
          history={history}
          activeId={active.id}
          wide={wide}
          stackedHeight={stackedPanelHeight(height)}
          tab={tab}
          tabIdPrefix={TABS_ID}
          diffShown={outputDiff.diffShown}
          tabs={tabs}
          stream={{
            waitingToolUseId,
            renderWaitingRow: (row) => (
              <PermissionPrompt
                ticketId={active.id}
                variant="inline"
                toolUseIds={row.toolUseIds}
                testID={`permission-${active.id}-inline`}
              />
            ),
            onWaitingRow: setWaitingRow,
            showThinking,
            renderUserActions: (row) =>
              // Rewind and fork (AL-265) act on the lead's session.
              row.messageId &&
              row.source !== "app-note" &&
              !activeCompanion ? (
                <UserMessageActions
                  messageId={row.messageId}
                  onRewind={(messageId) =>
                    setRewindTo({ messageId, caption: userCaption(row) })
                  }
                  onFork={(messageId) => {
                    setForkFrom(messageId);
                    setAssigning(true);
                  }}
                />
              ) : null,
          }}
          composer={
            // Skills, message box, Pause / Resume and Send under the stream (AL-176).
            <Composer
              key={active.id}
              ticketId={active.id}
              repo={ticket.repo}
              skills={activeRecord?.skills ?? []}
              switching={active.switching !== null}
              tools={<ModelEffortControls ticket={active} compact />}
            />
          }
          other={other}
          gateActions={<GateActions ticketId={ticket.id} placement="stepper" />}
          notices={notices}
          onGateChange={(stage, gate) =>
            setGate.mutate({ ticketId: ticket.id, stage, gate })
          }
          rail={rail}
        />
      }
    />
  );

  if (wide) {
    return (
      <View style={styles.page} onKeyDown={onKeyDown} testID="ticket-page">
        {header}
        {body}
      </View>
    );
  }
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.pageStacked}
      onKeyDown={onKeyDown}
      testID="ticket-page"
    >
      {header}
      {body}
    </ScrollView>
  );
}

/** The tab panel's height when the page scrolls as a whole (below 1200 px): most of the window. */
export function stackedPanelHeight(windowHeight: number): number {
  return Math.max(
    STACKED_PANEL_MIN_HEIGHT,
    Math.round(windowHeight) - STACKED_PANEL_CHROME,
  );
}

const TAB_TITLES: Record<TicketPageTab, string> = {
  output: "Output & diff",
  diff: "Output & diff",
  "build-log": "Build log",
  ado: "ADO",
};

function MissingTicket({
  ticketId,
  state,
  onRetry,
}: {
  ticketId: string;
  state: "loading" | "error" | "missing";
  onRetry: () => void;
}) {
  const { navigate } = useNavigation();
  return (
    <View style={[styles.page, styles.pageStacked]} testID="ticket-page">
      <TicketHeaderBand ticketId={ticketId} />
      <View style={styles.missing} aria-busy={state === "loading"}>
        <Text variant="display" size="xl" role="heading" aria-level={1}>
          {`#${ticketId}`}
        </Text>
        <Text variant="meta" size="md" testID="ticket-missing">
          {state === "loading"
            ? "Loading the ticket…"
            : state === "error"
              ? "Couldn't load this ticket."
              : "This ticket isn't on the board. It may have been archived."}
        </Text>
        {state === "error" ? (
          <Button
            label="Retry"
            onPress={onRetry}
            style={styles.missingAction}
          />
        ) : state === "missing" ? (
          <Button
            label="Back to the board"
            onPress={() => navigate(routes.board())}
            style={styles.missingAction}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Everything a child needs to fill the window: a flex column whose children can shrink. */
function column(): { flex: number; minHeight: number } {
  return { flex: 1, minHeight: 0 };
}

const PAGE_PADDING = { paddingTop: 14, paddingHorizontal: 18, paddingBottom: 18 } as const;

const styles = StyleSheet.create({
  // Flight deck frame (handoff): 14 px above, 18 px at the sides and below, 12 px between the rows.
  page: {
    ...column(),
    ...PAGE_PADDING,
    gap: space.md,
  },
  scroll: {
    flex: 1,
  },
  pageStacked: {
    ...PAGE_PADDING,
    gap: space.md,
  },
  tabsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  tabs: {
    alignSelf: "flex-start",
  },
  agentButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
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
    boxShadow: "none",
  },
  railCards: {
    gap: space.lg,
  },
  missing: {
    gap: space.md,
    alignItems: "flex-start",
  },
  missingAction: {
    marginTop: space.sm,
  },
});
