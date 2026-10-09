import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { subagentCountsLabel, type TicketSubBranch } from '@agent-lanes/contracts';
import { color, space } from '@agent-lanes/tokens';
import { GlassPanel, Pill, Text } from '@agent-lanes/ui';
import { subAgentTotal, type AgentTicket } from '@/entities/agent-ticket';
import { LeadAgentCard, SubAgentList, subAgentTree, useSubAgents } from '@/entities/sub-agent';
import { BuildRunControls } from '@/features/build-run';
import { ModelEffortControls } from '@/features/change-model';
import { MergeControls } from '@/features/merge-branches';
import { useBranchStatus } from '@/shared/api';
import { ErrorBoundary } from '@/shared/ui';
import { subBranchRows } from '../lib/sub-branch-rows';

/**
 * The drill-in's rail cards (AL-250, artboard 3 reshaped): Build / Run / Stop (AL-173), the merges
 * (AL-174), the agents (the lead agent with its model and effort switchers, AL-172, and the sub-agent
 * tree, AL-177) and sub-branch status (AL-178). Each card has its own error boundary, so one failing
 * card leaves the rest of the page working (design §12).
 */

interface PanelProps {
  title: string;
  /** Right of the title: the worktree branch, sub-agent counts. */
  aside?: ReactNode;
  children?: ReactNode;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

export function Panel({ title, aside, children, testID, style }: PanelProps) {
  return (
    <GlassPanel style={[styles.panel, style]} testID={testID}>
      <ErrorBoundary name={`panel:${testID}`} label={`the ${title} panel`}>
        <View style={styles.panelHeader}>
          <Text variant="title" role="heading" aria-level={2}>
            {title}
          </Text>
          {aside}
        </View>
        {children}
      </ErrorBoundary>
    </GlassPanel>
  );
}

/** Branch name, Build / Run / Stop and their status (AL-173, features/build-run). */
export function WorktreePanel({ ticket }: { ticket: AgentTicket }) {
  return (
    <Panel
      title="Worktree"
      testID="worktree-panel"
      aside={
        <Text variant="mono" size="xs" color={color.claudeText} numberOfLines={1} selectable style={styles.branch}>
          {ticket.branch}
        </Text>
      }
    >
      <BuildRunControls ticket={ticket} />
    </Panel>
  );
}

/** Merge sub-branches and Merge worktree → main, with the confirm and conflict flows (AL-174, features/merge-branches). */
export function MergePanel({ ticket }: { ticket: AgentTicket }) {
  return (
    <Panel title="Merge" testID="merge-panel">
      <MergeControls ticket={ticket} />
    </Panel>
  );
}

/**
 * The Agents card (AL-250): the lead agent with its model and effort switchers (AL-172; a change
 * shows "Switching · next turn" until it applies) and the sub-agent tree with each one's status,
 * line, model · effort and branch (AL-177, entities/sub-agent). The tree is read with
 * `agent:getSubagents` and kept current by `agent:subagent`; until it loads, the counts come from the
 * card's. The lead agent's tokens come from the live session usage (AL-113) when it has them.
 */
export function AgentsPanel({ ticket, leadTokens, footer }: { ticket: AgentTicket; leadTokens?: number; footer?: ReactNode }) {
  const subAgents = useSubAgents(ticket.id);
  const counts = subAgents.data?.counts ?? ticket.subAgents;
  const tree = subAgentTree(subAgents.data?.nodes ?? []);
  const lead = { stage: ticket.stage, model: ticket.model, effort: ticket.effort };
  const total = subAgents.data ? subAgents.data.nodes.length : subAgentTotal(ticket.subAgents);
  const countsLabel = subagentCountsLabel(counts);

  return (
    <Panel
      title="Agents"
      testID="sub-agents-panel"
      aside={
        <Text variant="meta" testID="sub-agents-counts">
          {countsLabel === 'none yet' ? 'None yet' : countsLabel}
        </Text>
      }
    >
      <LeadAgentCard lead={lead} role={total > 0 ? 'orchestrating' : 'working alone'} tokens={leadTokens && leadTokens > 0 ? leadTokens : (subAgents.data?.leadTokens ?? null)} />
      <ModelEffortControls ticket={ticket} />
      {tree.length > 0 ? (
        <SubAgentList items={tree} lead={lead} />
      ) : subAgents.isError ? (
        <Text variant="meta">{"Couldn't load the sub-agents."}</Text>
      ) : null}
      {footer}
    </Panel>
  );
}

/**
 * The ticket's `sub/…` branches with "N ahead" and Ready, and the branch they merge into (AL-178).
 * `branches:status` is read again after each merge and when a sub-agent starts or finishes (AL-085,
 * AL-086, AL-107), so the rows follow both.
 */
export function SubBranchesPanel({ ticket, subBranches }: { ticket: AgentTicket; subBranches: readonly TicketSubBranch[] }) {
  const status = useBranchStatus(ticket.id);
  const rows = subBranchRows(status.data?.subBranches, subBranches);
  return (
    <Panel
      title="Sub-branches"
      testID="sub-branches-panel"
      aside={
        <Text variant="mono" size="xs" color={color.muted} numberOfLines={1}>
          {`→ ${ticket.branch}`}
        </Text>
      }
    >
      {rows.length === 0 ? (
        <Text variant="meta">Writer sub-agents get their own branches here.</Text>
      ) : (
        <View role="list">
          {rows.map((row) => (
            <View key={row.branch} role="listitem" style={styles.subBranch} testID={`sub-branch-${row.branch}`}>
              <Text variant="mono" selectable numberOfLines={1} style={styles.flexText}>
                {row.branch}
              </Text>
              {row.ahead ? <Text variant="meta">{row.ahead}</Text> : null}
              {row.state ? <Pill label={row.state.label} tone={row.state.tone} /> : null}
            </View>
          ))}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.md,
    padding: space.lg,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.xs,
  },
  branch: {
    flexShrink: 1,
  },
  flexText: {
    flex: 1,
  },
  subBranch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});
