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
import { ErrorBoundary } from '@/shared/ui';

/**
 * The drill-in's panels as read-only summaries (artboard 3). The controls inside them are later
 * tickets' features: model and effort switching (AL-172), Build / Run / Stop (AL-173), the merges
 * (AL-174), the sub-agent tree (AL-177) and sub-branch status (AL-178). Each panel has its own error
 * boundary, so one failing panel leaves the rest of the page working (design §12).
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

/** Model on a track and effort as pills; a change shows "Switching · next turn" until it applies (AL-172). */
export function AgentPanel({ ticket }: { ticket: AgentTicket }) {
  return (
    <Panel title="Agent" testID="agent-panel" style={styles.flexPanel}>
      <ModelEffortControls ticket={ticket} />
    </Panel>
  );
}

/** Branch name, Build / Run / Stop and their status (AL-173, features/build-run). */
export function WorktreePanel({ ticket }: { ticket: AgentTicket }) {
  return (
    <Panel
      title="Worktree"
      testID="worktree-panel"
      style={styles.flexPanel}
      aside={
        <Text variant="mono" color={color.claudeText} numberOfLines={1} selectable style={styles.branch}>
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
    <Panel title="Merge" testID="merge-panel" style={styles.flexPanel}>
      <MergeControls ticket={ticket} />
    </Panel>
  );
}

/**
 * The lead agent and the sub-agent tree with each one's status, line, model · effort and branch
 * (AL-177, entities/sub-agent). The tree is read with `agent:getSubagents` and kept current by
 * `agent:subagent`; until it loads, the counts come from the card's.
 */
export function SubAgentsPanel({ ticket }: { ticket: AgentTicket }) {
  const subAgents = useSubAgents(ticket.id);
  const counts = subAgents.data?.counts ?? ticket.subAgents;
  const tree = subAgentTree(subAgents.data?.nodes ?? []);
  const lead = { stage: ticket.stage, model: ticket.model, effort: ticket.effort };
  const total = subAgents.data ? subAgents.data.nodes.length : subAgentTotal(ticket.subAgents);
  const countsLabel = subagentCountsLabel(counts);

  return (
    <Panel
      title="Sub-agents"
      testID="sub-agents-panel"
      aside={
        <Text variant="meta" testID="sub-agents-counts">
          {countsLabel === 'none yet' ? 'None yet' : countsLabel}
        </Text>
      }
    >
      <LeadAgentCard lead={lead} role={total > 0 ? 'orchestrating' : 'working alone'} tokens={subAgents.data?.leadTokens ?? null} />
      {tree.length > 0 ? (
        <SubAgentList items={tree} lead={lead} />
      ) : subAgents.isError ? (
        <Text variant="meta">{"Couldn't load the sub-agents."}</Text>
      ) : null}
    </Panel>
  );
}

export function SubBranchesPanel({ ticket, subBranches }: { ticket: AgentTicket; subBranches: readonly TicketSubBranch[] }) {
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
      {subBranches.length === 0 ? (
        <Text variant="meta">Writer sub-agents get their own branches here.</Text>
      ) : (
        subBranches.map((sub) => (
          <View key={sub.branch} style={styles.subBranch}>
            <Text variant="mono" selectable numberOfLines={1} style={styles.flexText}>
              {sub.branch}
            </Text>
            {sub.mergedAt !== null ? <Pill label="Merged" tone="ok" /> : null}
          </View>
        ))
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.md,
    padding: space.lg,
  },
  flexPanel: {
    flexGrow: 1,
    flexBasis: 280,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.sm,
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
