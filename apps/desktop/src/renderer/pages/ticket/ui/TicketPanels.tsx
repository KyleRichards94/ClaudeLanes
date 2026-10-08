import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatTokenCount, type TicketSubBranch } from '@agent-lanes/contracts';
import { color, radius, space } from '@agent-lanes/tokens';
import { GlassPanel, Icon, Pill, Text } from '@agent-lanes/ui';
import { EFFORT_LABELS, MODEL_LABELS, modelEffortLabel, subAgentTotal, type AgentTicket } from '@/entities/agent-ticket';
import { ErrorBoundary } from '@/shared/ui';
import { formatClock } from '../lib/format';

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

export function AgentPanel({ ticket }: { ticket: AgentTicket }) {
  return (
    <Panel title="Agent" testID="agent-panel" style={styles.flexPanel}>
      <View style={styles.valueRow}>
        <ValueChip label={MODEL_LABELS[ticket.model]} strong />
        <ValueChip label={EFFORT_LABELS[ticket.effort]} />
      </View>
      {ticket.switching ? (
        <Pill
          tone="ado"
          label={`Switching to ${modelEffortLabel(ticket.switching.model, ticket.switching.effort)} · next turn`}
          testID="agent-switching"
        />
      ) : (
        <Text variant="meta">Model and effort apply from the next turn when changed.</Text>
      )}
    </Panel>
  );
}

export function WorktreePanel({ ticket }: { ticket: AgentTicket }) {
  const last = ticket.build.last;
  const job = ticket.build.job;
  const buildLine = job
    ? job.state === 'queued'
      ? `${job.kind === 'run' ? 'Run' : 'Build'} queued${job.position ? ` · #${job.position}` : ''}`
      : `${job.kind === 'run' ? 'Starting run' : 'Building'}…`
    : last
      ? `Last build ${formatClock(last.finishedAt)} · ${last.outcome}`
      : 'Not built yet';
  const runLine = ticket.run.state === 'running' ? (ticket.run.url ? `Running · ${ticket.run.url}` : 'Running') : 'Not running';

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
      <View style={styles.statusRow}>
        <Text variant="meta" size="md">
          {buildLine}
        </Text>
        <Text variant="meta" size="md">
          {runLine}
        </Text>
      </View>
    </Panel>
  );
}

export function MergePanel({ ticket, subBranches }: { ticket: AgentTicket; subBranches: readonly TicketSubBranch[] }) {
  const unmerged = subBranches.filter((sub) => sub.mergedAt === null).length;
  return (
    <Panel title="Merge" testID="merge-panel" style={styles.flexPanel}>
      <View style={styles.mergeRow}>
        <Text variant="title" numberOfLines={1} style={styles.flexText}>
          {`Merge ${unmerged} sub-branch${unmerged === 1 ? '' : 'es'} → ${ticket.branch}`}
        </Text>
        <Icon name="merge" color={color.muted} size={16} />
      </View>
      <View style={[styles.mergeRow, styles.mergeMain]}>
        <Text variant="title" color={color.surface} numberOfLines={1} style={styles.flexText}>
          {`Merge worktree → ${ticket.baseBranch}`}
        </Text>
        <Icon name="arrow-right" color={color.surface} size={16} />
      </View>
    </Panel>
  );
}

export function SubAgentsPanel({ ticket, leadTokens }: { ticket: AgentTicket; leadTokens?: number }) {
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
        <View style={styles.leadText}>
          <Text variant="title" size="lg" color={color.surface}>
            Lead agent
          </Text>
          <Text variant="body" size="sm" color={color.surface}>
            {`${modelEffortLabel(ticket.model, ticket.effort)} · ${subAgentTotal(ticket.subAgents) > 0 ? 'orchestrating' : 'working alone'}`}
          </Text>
        </View>
        {leadTokens ? (
          // "212k tokens" (artboard 3, AL-113): the lead agent's own tokens.
          <View style={styles.leadTokens} testID="lead-agent-tokens">
            <Text variant="mono" size="sm" color={color.surface}>
              {formatTokenCount(leadTokens)}
            </Text>
          </View>
        ) : null}
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

function ValueChip({ label, strong = false }: { label: string; strong?: boolean }) {
  return (
    <View style={[styles.valueChip, strong && styles.valueChipStrong]}>
      <Text variant="title" color={strong ? color.claudeText : color.ink}>
        {label}
      </Text>
    </View>
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
  valueRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.sm,
  },
  valueChip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  valueChipStrong: {
    borderColor: color.claudeTint,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
  },
  mergeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    marginBottom: space.sm,
  },
  mergeMain: {
    backgroundColor: color.ink,
    borderColor: color.ink,
  },
  flexText: {
    flex: 1,
  },
  leadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: color.claude,
  },
  leadText: {
    flex: 1,
    gap: space.xs,
  },
  leadTokens: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.claudeText,
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
