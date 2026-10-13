import { useCallback, useMemo, type ReactNode } from "react";
import type { TicketRecord, TicketStageEntry } from "@agent-lanes/contracts";
import { latestActiveFile } from "@/entities/agent";
import type { AgentTicket } from "@/entities/agent-ticket";
import { FileDiff, useDiffFiles } from "@/entities/diff-file";
import { useReviewFindings } from "@/entities/review-finding";
import { useAgents } from "@/features/ticket-insight";
import { LANE_LABELS } from "@/shared/config";
import {
  clearSelection,
  selectFile,
  setDiffMode,
  useCodeCityLegendDismissed,
  useDiffMode,
  useFollowAgent,
  useSelectedFilePath,
  useUiPrefs,
} from "@/shared/model";
import { CodeCity, type CityStage } from "@/widgets/code-city";
import { stageSteps } from "../lib/stage-steps";

export interface CodeCityPanelProps {
  /** The lead's ticket: Code City shows the whole ticket, whichever agent the page has open. */
  ticket: AgentTicket;
  companions: readonly TicketRecord[];
  history: readonly TicketStageEntry[];
  /** The compact composer under the stage track (the page's own, so its draft, skill chip and model carry across). */
  composer: ReactNode;
  /** The Worktree card at the bottom of the inspector rail. */
  worktree: ReactNode;
}

/**
 * Code City wired to the ticket (AL-275): the page's seam between the presentational `widgets/code-city` and
 * the entities. The files come from `diff:files`, the agents and their pins from the output stream, the review
 * from `review:findings`, and the selection, Follow agent and diff mode from the shared ticket view, so a file
 * picked in Flight deck is the one picked here. `LayoutSwitch` lazy-loads this module, widget and all.
 */
export default function CodeCityPanel({
  ticket,
  companions,
  history,
  composer,
  worktree,
}: CodeCityPanelProps) {
  const ticketId = ticket.id;
  const diff = useDiffFiles(ticketId);
  const agents = useAgents(ticketId, companions);
  const companionIds = useMemo(
    () => companions.map((companion) => companion.id),
    [companions],
  );
  const findings = useReviewFindings(ticketId, { watch: companionIds });
  const selectedFilePath = useSelectedFilePath(ticketId);
  const followAgent = useFollowAgent(ticketId);
  const diffMode = useDiffMode(ticketId);
  const legendDismissed = useCodeCityLegendDismissed();

  const stages = useMemo<CityStage[]>(
    () =>
      stageSteps(ticket.stage, history).map((step) => {
        const gate = ticket.gates[step.stage] === "approval" ? "Approval" : "Auto";
        const progress = step.state === "current" ? ticket.progress : null;
        return {
          id: step.stage,
          label: LANE_LABELS[step.stage],
          state: step.state === "upcoming" ? "upcoming" : step.state,
          caption:
            step.state === "done"
              ? gate === "Approval"
                ? "Approved"
                : gate
              : progress !== null
                ? `${gate} · ${Math.round(progress * 100)}%`
                : gate,
          progress,
        };
      }),
    [ticket.stage, ticket.gates, ticket.progress, history],
  );

  const onSelectFile = useCallback(
    (path: string | null) =>
      path === null ? clearSelection(ticketId) : selectFile(ticketId, path),
    [ticketId],
  );

  return (
    <CodeCity
      files={diff.data?.files ?? []}
      base={diff.data?.base ?? ticket.baseBranch}
      loading={diff.isPending}
      error={diff.isError ? { message: diff.error.message } : null}
      onRetry={() => void diff.refetch()}
      agents={agents}
      reviewStatus={diff.data?.reviewStatus ?? {}}
      findings={findings.data ?? []}
      selectedFilePath={selectedFilePath}
      onSelectFile={onSelectFile}
      followAgent={followAgent}
      latestActivityPath={latestActiveFile(agents)}
      diffMode={diffMode}
      onDiffModeChange={(mode) => setDiffMode(ticketId, mode)}
      stages={stages}
      legendDismissed={legendDismissed}
      onDismissLegend={() =>
        useUiPrefs.getState().setCodeCityLegendDismissed(true)
      }
      renderDiff={(file, mode, stripeColor) => (
        <FileDiff
          ticketId={ticketId}
          path={file.path}
          oldPath={file.oldPath}
          view={mode}
          stripeColor={stripeColor}
        />
      )}
      composer={composer}
      worktree={worktree}
    />
  );
}
