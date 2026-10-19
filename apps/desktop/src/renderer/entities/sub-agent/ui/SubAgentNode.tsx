import type { Effort, Lane, Model, SubagentNode as SubagentNodeData, SubagentStatus } from '@agent-lanes/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Button, Pill, Text, type PillTone } from '@agent-lanes/ui';
import { modelEffortLabel } from '@/shared/config';
import { subAgentRow, tokensLabel, type SubAgentTreeNode } from '../model/tree';

const STATUS_TONES: Readonly<Record<SubagentStatus, PillTone>> = {
  queued: 'neutral',
  running: 'claude',
  done: 'ok',
  failed: 'danger',
};

export interface LeadAgent {
  stage: Lane;
  model: Model;
  effort: Effort;
}

/** What a sub-agent card can do (AL-261): show its output in the stream, and stop it while it runs. */
export interface SubAgentActions {
  onSelect?: (node: SubagentNodeData) => void;
  onStop?: (node: SubagentNodeData) => void;
  /** The node whose Stop is in flight. */
  stoppingId?: string | null;
}

/**
 * The lead agent's violet card at the top of the Sub-agents column (artboard 3): "Lead agent",
 * "Opus · XHigh · orchestrating" and its tokens.
 */
export function LeadAgentCard({ lead, role, tokens }: { lead: LeadAgent; role: string; tokens: number | null }) {
  return (
    <View style={styles.lead} testID="lead-agent">
      <View style={styles.leadText}>
        <Text variant="title" size="lg" color={color.onAccent}>
          Lead agent
        </Text>
        <Text variant="body" size="sm" color={color.onAccent} numberOfLines={1}>
          {`${modelEffortLabel(lead.model, lead.effort)} · ${role}`}
        </Text>
      </View>
      {tokens !== null && tokens > 0 ? (
        <View style={styles.tokens} testID="lead-agent-tokens">
          <Text variant="mono" size="sm" color={color.onAccent}>
            {tokensLabel(tokens)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One sub-agent (AL-177, artboard 3): name and status pill, its activity or what it was asked
 * ("Starts at the Code review stage" while it waits for that stage), model · effort and its branch or
 * "read-only". The ones it spawned hang under it.
 */
export function SubAgentNode({ item, lead, actions }: { item: SubAgentTreeNode; lead: LeadAgent; actions?: SubAgentActions }) {
  const row = subAgentRow(item.node, lead);
  const { node } = item;
  const canStop = Boolean(actions?.onStop) && node.taskId !== null && (node.status === 'running' || node.status === 'queued');
  return (
    <View role="listitem" style={styles.item}>
      <Pressable
        role={actions?.onSelect ? 'button' : undefined}
        aria-label={`${row.name}, ${row.statusLabel}`}
        disabled={!actions?.onSelect}
        onPress={actions?.onSelect ? () => actions.onSelect?.(node) : undefined}
        style={styles.card}
        testID={`sub-agent-${node.id}`}
      >
        <View style={styles.header}>
          <Text variant="title" numberOfLines={1} style={styles.flexText}>
            {row.name}
          </Text>
          <Pill label={row.statusLabel} tone={STATUS_TONES[row.status]} dot />
          {canStop ? (
            <Button
              size="sm"
              variant="danger"
              label="Stop"
              icon="stop"
              loading={actions?.stoppingId === node.id}
              onPress={() => actions?.onStop?.(node)}
              testID={`sub-agent-${node.id}-stop`}
            />
          ) : null}
        </View>
        {row.line ? (
          <Text variant="body" size="sm" numberOfLines={2} testID={`sub-agent-${item.node.id}-line`}>
            {row.line}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <Text variant="meta" numberOfLines={1} style={styles.flexText}>
            {row.modelLine}
          </Text>
          {node.tokens !== null && node.tokens > 0 ? (
            <Text variant="mono" size="xs" color={color.muted} numberOfLines={1} testID={`sub-agent-${node.id}-tokens`}>
              {tokensLabel(node.tokens)}
            </Text>
          ) : null}
          <Text variant="mono" size="xs" color={color.muted} numberOfLines={1} selectable style={styles.branch}>
            {row.branchLine}
          </Text>
        </View>
      </Pressable>
      {item.children.length > 0 ? <SubAgentList items={item.children} lead={lead} actions={actions} nested /> : null}
    </View>
  );
}

/** Sub-agents under the lead agent (or under another sub-agent), on a line that ties them to it. */
export function SubAgentList({ items, lead, actions, nested = false }: { items: readonly SubAgentTreeNode[]; lead: LeadAgent; actions?: SubAgentActions; nested?: boolean }) {
  return (
    <View role="list" style={[styles.list, nested && styles.nested]}>
      {items.map((item) => (
        <SubAgentNode key={item.node.id} item={item} lead={lead} actions={actions} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  lead: {
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
  tokens: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  // The tree's spine: a line down the left, the cards indented past it (artboard 3).
  list: {
    gap: space.sm,
    marginLeft: space.xl,
    paddingLeft: space.lg,
    borderLeftWidth: 2,
    borderLeftColor: color.line,
  },
  nested: {
    marginTop: space.sm,
    marginLeft: space.md,
  },
  item: {
    gap: 0,
  },
  card: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  flexText: {
    flex: 1,
  },
  branch: {
    flexShrink: 1,
  },
});
