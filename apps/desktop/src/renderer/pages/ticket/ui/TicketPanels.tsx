import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { subagentCountsLabel, type TicketRecord, type TicketSubBranch } from '@agent-lanes/contracts';
import { color, space } from '@agent-lanes/tokens';
import { Button, GlassPanel, Pill, Text } from '@agent-lanes/ui';
import { subAgentTotal, useArchiveTicket, type AgentTicket } from '@/entities/agent-ticket';
import { LeadAgentCard, SubAgentList, subAgentTree, useSubAgents, type SubAgentActions } from '@/entities/sub-agent';
import { BuildRunControls } from '@/features/build-run';
import { MergeControls } from '@/features/merge-branches';
import { useAgentUsage, useBranchStatus, useOpenWorktree, useSessionStatus, useStopSession } from '@/shared/api';
import { toast } from '@/shared/model';
import { ErrorBoundary } from '@/shared/ui';
import { companionDetail, companionLabel } from '../lib/companions';
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
  const openFolder = useOpenWorktree(ticket.id);
  return (
    <Panel
      title="Worktree"
      testID="worktree-panel"
      aside={
        <View style={styles.worktreeAside}>
          <Text variant="mono" size="xs" color={color.claudeText} numberOfLines={1} selectable style={styles.branch}>
            {ticket.branch}
          </Text>
          {/* Open worktree folder (AL-267). */}
          <Button
            size="sm"
            variant="secondary"
            icon="folder"
            iconOnly
            label="Open worktree folder"
            loading={openFolder.isPending}
            onPress={() => openFolder.mutate(undefined, { onError: (error) => toast({ id: `open-worktree:${ticket.id}`, tone: 'error', title: "Couldn't open the worktree folder", body: error.message }) })}
            testID="open-worktree-folder"
          />
        </View>
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
 * The Agents card (AL-250): the lead agent (its model and effort switch in the composer footer, AL-259)
 * and the sub-agent tree with each one's status,
 * line, model · effort and branch (AL-177, entities/sub-agent). The tree is read with
 * `agent:getSubagents` and kept current by `agent:subagent`; until it loads, the counts come from the
 * card's. The lead agent's tokens come from the live session usage (AL-113) when it has them.
 */
export function AgentsPanel({ ticket, leadTokens, footer, actions, companions = [], activeId, onOpenCompanion }: { ticket: AgentTicket; leadTokens?: number; footer?: ReactNode; actions?: SubAgentActions; /** The ticket's second agents (AL-266), oldest first. */ companions?: readonly TicketRecord[]; /** The agent whose output the page shows. */ activeId?: string; onOpenCompanion?: (companionId: string) => void }) {
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
      {tree.length > 0 ? (
        <SubAgentList items={tree} lead={lead} actions={actions} />
      ) : subAgents.isError ? (
        <Text variant="meta">{"Couldn't load the sub-agents."}</Text>
      ) : null}
      {companions.length > 0 ? (
        <View role="list" testID="companions">
          {companions.map((companion) => (
            <CompanionRow key={companion.id} record={companion} active={companion.id === activeId} onOpen={onOpenCompanion} />
          ))}
        </View>
      ) : null}
      {footer}
    </Panel>
  );
}

/** Session states with a `claude` process behind them. */
const LIVE_STATES = new Set(['starting', 'running', 'idle', 'paused']);

/**
 * One second agent on the Agents card (AL-266): its name and role, where it works, its session state
 * and tokens, Open (the page switches to its output), Stop while it runs, Remove once it has ended.
 */
function CompanionRow({ record, active, onOpen }: { record: TicketRecord; active: boolean; onOpen?: (companionId: string) => void }) {
  const companion = record.companion!;
  const status = useSessionStatus(record.id).data;
  const usage = useAgentUsage(record.id).data;
  const stop = useStopSession(record.id);
  const remove = useArchiveTicket();
  const live = status ? LIVE_STATES.has(status.state) : false;
  const state = status?.state ?? 'none';
  const stateLabel = state === 'none' ? 'Not started' : state === 'queued' ? 'Queued' : state.charAt(0).toUpperCase() + state.slice(1);
  const stateTone = state === 'running' || state === 'starting' ? 'ok' : state === 'lost' ? 'danger' : state === 'idle' || state === 'paused' || state === 'queued' ? 'attention' : 'neutral';
  const tokens = usage?.leadTokens ?? 0;
  return (
    <View role="listitem" style={[styles.companion, active && styles.companionActive]} testID={`companion-${record.id}`}>
      <View style={styles.companionText}>
        <View style={styles.companionTitle}>
          <Text variant="title" size="sm" numberOfLines={1} style={styles.flexText}>
            {companionLabel(companion)}
          </Text>
          <Pill label={stateLabel} tone={stateTone} />
        </View>
        <Text variant="mono" size="xs" color={color.muted} numberOfLines={1} selectable>
          {companionDetail({ branch: record.branch, companion })}
        </Text>
        {tokens > 0 ? (
          <Text variant="meta" size="sm">
            {`${tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : tokens} tokens`}
          </Text>
        ) : null}
      </View>
      <View style={styles.companionActions}>
        {onOpen && !active ? <Button size="sm" variant="secondary" label="Open" onPress={() => onOpen(record.id)} testID={`companion-${record.id}-open`} /> : null}
        {live || state === 'queued' ? (
          <Button
            size="sm"
            variant="secondary"
            icon="stop"
            label="Stop"
            loading={stop.isPending}
            onPress={() => stop.mutate(undefined, { onError: (error) => toast({ id: `stop:${record.id}`, tone: 'error', title: `Couldn't stop ${companion.name}`, body: error.message }) })}
            testID={`companion-${record.id}-stop`}
          />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon="archive"
            label="Remove"
            loading={remove.isPending}
            onPress={() =>
              remove.mutate(
                { ticketId: record.id },
                {
                  onSuccess: () => toast({ id: `removed:${record.id}`, tone: 'success', title: `Removed ${companion.name}`, body: companion.role === 'helper' ? `Its branch ${record.branch} stays until the ticket is archived.` : 'Its output is gone; the ticket worktree is untouched.' }),
                  onError: (error) => toast({ id: `remove:${record.id}`, tone: 'error', title: `Couldn't remove ${companion.name}`, body: error.message }),
                },
              )
            }
            testID={`companion-${record.id}-remove`}
          />
        )}
      </View>
    </View>
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
  worktreeAside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 1,
  },
  flexText: {
    flex: 1,
  },
  companion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  companionActive: {
    backgroundColor: color.claudeTint,
  },
  companionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  companionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  companionActions: {
    flexDirection: 'row',
    gap: space.xs,
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
