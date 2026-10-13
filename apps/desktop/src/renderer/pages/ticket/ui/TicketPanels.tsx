import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { subagentCountsLabel, type SubagentStatus, type TicketRecord, type TicketSubBranch } from '@agent-lanes/contracts';
import { color, space } from '@agent-lanes/tokens';
import { Button, GlassPanel, Pill, Text, type PillTone } from '@agent-lanes/ui';
import { subAgentTotal, useArchiveTicket, type AgentTicket } from '@/entities/agent-ticket';
import { subAgentRow, useSubAgents, type SubAgentActions } from '@/entities/sub-agent';
import { BuildRunControls } from '@/features/build-run';
import { MergeControls, isMergeable } from '@/features/merge-branches';
import { useAgents } from '@/features/ticket-insight';
import { useBranchStatus, useOpenWorktree, useSessionStatus, useStopSession } from '@/shared/api';
import { modelEffortLabel } from '@/shared/config';
import { toast } from '@/shared/model';
import { ErrorBoundary } from '@/shared/ui';
import { AgentDonut, type AgentStatusPill } from '@/widgets/flight-deck';
import { COMPANION_ROLE_LABELS, companionDetail } from '../lib/companions';
import { subBranchRows } from '../lib/sub-branch-rows';
import { useCompanionTokens } from '../model/companion-tokens';

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
      <BuildRunControls ticket={ticket} compact />
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
 * The Agents card (AL-250, restyled for Flight deck in AL-279): a donut with a segment per agent and a row per agent
 * (the lead, its sub-agents, and the second agents, AL-266) from `useAgents`, which `widgets/flight-deck` draws. The
 * rows keep what the tree card showed: the lead's model · effort and role, a sub-agent's latest activity, model and
 * branch, a second agent's role and where it works, tokens, and the actions: pressing a sub-agent's row shows its
 * output in the stream and Stop ends it while it runs (AL-261); a second agent has Open, Stop and Remove. The tree
 * is read with `agent:getSubagents` and kept current by `agent:subagent`; until it loads, the counts come from the
 * card's. The lead agent's tokens come from the live session usage (AL-113) when it has them.
 */
export function AgentsPanel({ ticket, leadTokens, footer, actions, companions = [], activeId, onOpenCompanion }: { ticket: AgentTicket; leadTokens?: number; footer?: ReactNode; actions?: SubAgentActions; /** The ticket's second agents (AL-266), oldest first. */ companions?: readonly TicketRecord[]; /** The agent whose output the page shows. */ activeId?: string; onOpenCompanion?: (companionId: string) => void }) {
  const subAgents = useSubAgents(ticket.id);
  const agents = useAgents(ticket.id, companions);
  const branches = useBranchStatus(ticket.id);
  const companionTokens = useCompanionTokens(companions);
  const counts = subAgents.data?.counts ?? ticket.subAgents;
  const nodes = new Map((subAgents.data?.nodes ?? []).map((node) => [node.id, node]));
  const records = new Map(companions.map((record) => [record.id, record]));
  const lead = { stage: ticket.stage, model: ticket.model, effort: ticket.effort };
  const total = subAgents.data ? subAgents.data.nodes.length : subAgentTotal(ticket.subAgents);
  const countsLabel = subagentCountsLabel(counts);
  const subBranchesReady = (branches.data?.subBranches ?? []).filter(isMergeable).length;

  // Each agent's lines, status pill and tokens, as the old tree card said them.
  const lines: Record<string, readonly string[]> = {};
  const statuses: Record<string, AgentStatusPill> = {};
  const shown = agents.map((agent) => {
    const node = nodes.get(agent.id);
    const record = records.get(agent.id);
    if (agent.role === 'lead') {
      lines[agent.id] = [`${modelEffortLabel(lead.model, lead.effort)} · ${total > 0 ? 'orchestrating' : 'working alone'}`];
      return { ...agent, tokens: leadTokens && leadTokens > 0 ? leadTokens : agent.tokens };
    }
    if (node) {
      const row = subAgentRow(node, lead);
      lines[agent.id] = [row.line, row.modelLine, row.branchLine].filter((line) => line !== '');
      statuses[agent.id] = { label: row.statusLabel, tone: SUB_AGENT_TONES[row.status] };
      return agent;
    }
    if (record?.companion) {
      lines[agent.id] = [COMPANION_ROLE_LABELS[record.companion.role], companionDetail({ branch: record.branch, companion: record.companion })];
      return { ...agent, tokens: companionTokens[agent.id] ?? null };
    }
    return agent;
  });

  return (
    <AgentDonut
      agents={shown}
      lines={lines}
      statuses={statuses}
      counts={countsLabel === 'none yet' ? 'None yet' : countsLabel}
      subBranchesReady={subBranchesReady}
      activeId={activeId ?? ticket.id}
      onOpenAgent={(agent) => {
        const node = nodes.get(agent.id);
        if (node) actions?.onSelect?.(node);
        else onOpenCompanion?.(agent.id);
      }}
      renderActions={(agent) => {
        const node = nodes.get(agent.id);
        if (node) {
          const canStop = Boolean(actions?.onStop) && node.taskId !== null && (node.status === 'running' || node.status === 'queued');
          return canStop ? (
            <Button size="sm" variant="danger" label="Stop" icon="stop" loading={actions?.stoppingId === node.id} onPress={() => actions?.onStop?.(node)} testID={`sub-agent-${node.id}-stop`} />
          ) : null;
        }
        const record = records.get(agent.id);
        return record ? <CompanionActions record={record} active={record.id === activeId} onOpen={onOpenCompanion} /> : null;
      }}
      rowTestID={(agent) => (agent.role === 'lead' ? 'lead-agent' : records.has(agent.id) ? `companion-${agent.id}` : `sub-agent-${agent.id}`)}
      notice={subAgents.isError ? <Text variant="meta">{"Couldn't load the sub-agents."}</Text> : null}
      footer={footer}
    />
  );
}

const SUB_AGENT_TONES = { queued: 'neutral', running: 'claude', done: 'ok', failed: 'danger' } as const satisfies Record<SubagentStatus, PillTone>;

/** Session states with a `claude` process behind them. */
const LIVE_STATES = new Set(['starting', 'running', 'idle', 'paused']);

/** A second agent's Open (the page switches to its output), Stop while it runs, and Remove once it has ended (AL-266). */
function CompanionActions({ record, active, onOpen }: { record: TicketRecord; active: boolean; onOpen?: (companionId: string) => void }) {
  const companion = record.companion!;
  const status = useSessionStatus(record.id).data;
  const stop = useStopSession(record.id);
  const remove = useArchiveTicket();
  const live = status ? LIVE_STATES.has(status.state) : false;
  const state = status?.state ?? 'none';
  return (
    <>
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
    </>
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
  subBranch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});
