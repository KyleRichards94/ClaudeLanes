import { useCallback, useMemo, type ReactNode } from 'react';
import type { Gate, Stage, TicketRecord, TicketStageEntry } from '@agent-lanes/contracts';
import { latestActiveFile } from '@/entities/agent';
import { requestOutputTurnScroll } from '@/entities/agent-output';
import type { AgentTicket } from '@/entities/agent-ticket';
import { FileDiff, useDiffFiles } from '@/entities/diff-file';
import { useAgents, useTurns } from '@/features/ticket-insight';
import {
  selectFile,
  selectTurn,
  setDiffMode,
  setFollowAgent,
  useDiffMode,
  useFollowAgent,
  useSelectedFilePath,
  useSelectedTurn,
} from '@/shared/model';
import { ErrorBoundary } from '@/shared/ui';
import {
  DiffColumn,
  FlightDeck,
  GroupedOutput,
  WorkflowCard,
  reviewProgress,
  workflowStages,
  type GroupedOutputProps,
} from '@/widgets/flight-deck';
import { stageSteps } from '../lib/stage-steps';

export interface FlightDeckPanelProps {
  /** The lead's ticket: the workflow, the diff and the agents are the whole ticket's, whichever agent the page has open. */
  ticket: AgentTicket;
  companions: readonly TicketRecord[];
  history: readonly TicketStageEntry[];
  /** The agent whose output and turns the page shows: the lead, or a second agent. */
  activeId: string;
  wide: boolean;
  /** The columns' height when the page scrolls as a whole. */
  stackedHeight: number;
  tab: string;
  tabIdPrefix: string;
  /** The Output & diff view's Hide diff. */
  diffShown: boolean;
  /** The tab bar row, with Hide / Show diff and the agent switcher. */
  tabs: ReactNode;
  /** What the stream needs from the page: the permission prompt at the waiting row, Rewind and Fork, thinking. */
  stream: GroupedOutputProps['stream'];
  /** The composer, pinned under the output. */
  composer: ReactNode;
  /** The Build log or ADO tab's content. */
  other: ReactNode;
  /** Approve / Request changes for the gate that waits. */
  gateActions: ReactNode;
  /** The permission banner, the queued notice and a gate error: what needs the user above the body. */
  notices: ReactNode;
  onGateChange(stage: Stage, gate: Gate): void;
  /** The right rail's cards, built by the page from its own panels (Create PR, Agents, Worktree, Merge, Sub-branches). */
  rail: ReactNode;
}

/**
 * Flight deck wired to the ticket (AL-279): the page's seam between the presentational `widgets/flight-deck` and
 * the entities. The workflow card reads the stage steps, gates, turns and review progress; the strip and the
 * output read the turns of the agent on screen; the change map and diff read `diff:files`; the agents come from
 * the output streams. The selection, Follow agent and diff mode are the shared ticket view's, so a file picked in
 * Code City is the one picked here. What widgets cannot import (the page's panels, the composer, the permission
 * prompt) arrives as the slots in the props.
 */
export function FlightDeckPanel({
  ticket,
  companions,
  history,
  activeId,
  wide,
  stackedHeight,
  tab,
  tabIdPrefix,
  diffShown,
  tabs,
  stream,
  composer,
  other,
  gateActions,
  notices,
  onGateChange,
  rail,
}: FlightDeckPanelProps) {
  const ticketId = ticket.id;
  const diff = useDiffFiles(ticketId);
  const agents = useAgents(ticketId, companions);
  const turns = useTurns(activeId, history);
  const leadTurns = useTurns(ticketId, history);
  const selectedFilePath = useSelectedFilePath(ticketId);
  const selectedTurn = useSelectedTurn(ticketId);
  const followAgent = useFollowAgent(ticketId);
  const diffMode = useDiffMode(ticketId);

  const files = useMemo(() => diff.data?.files ?? [], [diff.data]);
  const stages = useMemo(
    () =>
      workflowStages({
        steps: stageSteps(ticket.stage, history),
        gates: ticket.gates,
        waitingStage: ticket.gate?.stage ?? null,
        turns: leadTurns,
        progress: ticket.progress,
        review: reviewProgress(
          files.map((file) => file.path),
          diff.data?.reviewStatus ?? {},
        ),
      }),
    [ticket.stage, ticket.gates, ticket.gate, ticket.progress, history, leadTurns, files, diff.data],
  );

  const onSelectFile = useCallback((path: string) => selectFile(ticketId, path), [ticketId]);
  const onSelectTurn = useCallback(
    (index: number) => {
      selectTurn(ticketId, index);
      requestOutputTurnScroll(activeId, index);
    },
    [ticketId, activeId],
  );

  return (
    <FlightDeck
      wide={wide}
      stackedHeight={stackedHeight}
      tab={tab}
      tabIdPrefix={tabIdPrefix}
      workflow={
        <ErrorBoundary name="ticket:stepper" label="the stage stepper">
          <WorkflowCard
            stages={stages}
            onGateChange={onGateChange}
            turns={turns}
            agents={agents}
            selectedTurn={selectedTurn}
            onSelectTurn={onSelectTurn}
            gateActions={gateActions}
            notices={notices}
            testID="ticket-stepper-band"
          />
        </ErrorBoundary>
      }
      tabs={tabs}
      output={<GroupedOutput ticketId={activeId} turns={turns} agents={agents} selectedTurn={selectedTurn} stream={stream} composer={composer} />}
      diffShown={diffShown}
      diff={
        <ErrorBoundary name="ticket:diff-pane" label="the diff">
          <DiffColumn
            files={files}
            agents={agents}
            selectedFilePath={selectedFilePath}
            onSelectFile={onSelectFile}
            loading={diff.isPending}
            error={diff.isError ? { message: diff.error.message } : null}
            onRetry={() => void diff.refetch()}
            followAgent={followAgent}
            onFollowChange={(follow) => setFollowAgent(ticketId, follow)}
            latestActivityPath={latestActiveFile(agents)}
            diffMode={diffMode}
            onDiffModeChange={(mode) => setDiffMode(ticketId, mode)}
            renderDiff={(file, mode, stripeColor) => <FileDiff ticketId={ticketId} path={file.path} oldPath={file.oldPath} view={mode} stripeColor={stripeColor} />}
          />
        </ErrorBoundary>
      }
      other={other}
      rail={rail}
    />
  );
}
