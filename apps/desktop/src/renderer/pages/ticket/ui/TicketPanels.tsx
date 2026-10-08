import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { TicketSubBranch } from '@agent-lanes/contracts';
import { color, radius, space } from '@agent-lanes/tokens';
import { GlassPanel, Pill, Text } from '@agent-lanes/ui';
import { modelEffortLabel, subAgentTotal, type AgentTicket } from '@/entities/agent-ticket';
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

export function SubAgentsPanel({ ticket }: { ticket: AgentTicket }) {
  const { running, done, queued, failed } = ticket.subAgents;
  const counts = [
    running ? `${running} running` : null,
    done ? `${done} done` : null,
    queued ? `${queued} queued` : null,
    failed ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Panel
      title="Sub-agents"
      testID="sub-agents-panel"
      aside={<Text variant="meta">{counts || 'None yet'}</Text>}
    >
      <View style={styles.leadCard} testID="lead-agent">
        <Text variant="title" size="lg" color={color.surface}>
          Lead agent
        </Text>
        <Text variant="body" size="sm" color={color.surface}>
          {`${modelEffortLabel(ticket.model, ticket.effort)} · ${subAgentTotal(ticket.subAgents) > 0 ? 'orchestrating' : 'working alone'}`}
        </Text>
      </View>
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
  leadCard: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: color.claude,
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
