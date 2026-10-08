import { LANES, type Effort, type Lane, type Model, type Stage, type SubagentNode, type SubagentStatus } from '@agent-lanes/contracts';
import { EFFORT_LABELS, LANE_LABELS, MODEL_LABELS } from '@/shared/config';

/** A sub-agent with the ones it spawned, for the panel's tree (artboard 3). */
export interface SubAgentTreeNode {
  node: SubagentNode;
  children: readonly SubAgentTreeNode[];
}

/**
 * Nests the flat list from `agent:getSubagents` / `agent:subagent` by `parentId`, oldest first. A
 * node whose parent was dropped from the capped tree (AL-107 keeps 200) sits at the top level.
 */
export function subAgentTree(nodes: readonly SubagentNode[]): readonly SubAgentTreeNode[] {
  const ordered = [...nodes].sort((a, b) => a.startedAt - b.startedAt);
  const ids = new Set(ordered.map((node) => node.id));
  const byParent = new Map<string | null, SubagentNode[]>();
  for (const node of ordered) {
    const parent = node.parentId !== null && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  }
  const seen = new Set<string>();
  const build = (parent: string | null): SubAgentTreeNode[] =>
    (byParent.get(parent) ?? [])
      .filter((node) => !seen.has(node.id) && seen.add(node.id))
      .map((node) => ({ node, children: build(node.id) }));
  return build(null);
}

/** Agent types that review, which the lead agent runs at the Code review stage (design §9). */
const REVIEW_TYPES = new Set(['reviewer', 'code-reviewer', 'review']);
/** Agent types that test, run at the QA stage. */
const QA_TYPES = new Set(['qa', 'tester', 'qa-tester']);

/** The stage a queued sub-agent is waiting for, from its type: reviewers at Code review, testers at QA. */
export function stageOf(node: Pick<SubagentNode, 'agentType' | 'name'>): Stage | null {
  const key = (node.agentType ?? node.name).trim().toLowerCase();
  if (REVIEW_TYPES.has(key) || key.endsWith('-reviewer')) return 'code-review';
  if (QA_TYPES.has(key) || key.endsWith('-tester')) return 'qa';
  return null;
}

function before(stage: Lane, target: Stage): boolean {
  return LANES.indexOf(stage) < LANES.indexOf(target);
}

/** What a sub-agent row says, read off artboard 3's Sub-agents column. */
export interface SubAgentRow {
  name: string;
  status: SubagentStatus;
  /** "Queued", "Running", "Done", "Failed". */
  statusLabel: string;
  /** Its latest activity or result, else what it was asked; "Starts at the Code review stage" while it waits for one. */
  line: string;
  /** "Sonnet · High": its own model and effort, else the lead agent's it inherits. */
  modelLine: string;
  /** Its sub-branch, "read-only" for one that shares the ticket worktree, "—" when it has none yet. */
  branchLine: string;
}

export const SUB_AGENT_STATUS_LABELS: Readonly<Record<SubagentStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

export function subAgentRow(node: SubagentNode, lead: { stage: Lane; model: Model; effort: Effort }): SubAgentRow {
  const waitsFor = node.status === 'queued' ? stageOf(node) : null;
  const line =
    waitsFor !== null && before(lead.stage, waitsFor)
      ? `Starts at the ${LANE_LABELS[waitsFor]} stage`
      : node.activity?.trim() || node.description.trim() || (node.status === 'queued' ? 'Waiting to start' : '');
  return {
    name: node.name,
    status: node.status,
    statusLabel: SUB_AGENT_STATUS_LABELS[node.status],
    line,
    modelLine: `${MODEL_LABELS[node.model ?? lead.model]} · ${EFFORT_LABELS[node.effort ?? lead.effort]}`,
    branchLine: node.branch ?? (node.readOnly && node.status !== 'queued' ? 'read-only' : '—'),
  };
}

/** "212k tokens", "980 tokens", "1.2M tokens". */
export function tokensLabel(tokens: number): string {
  if (tokens < 1_000) return `${tokens} tokens`;
  if (tokens < 999_500) return `${Math.round(tokens / 1_000)}k tokens`;
  return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
}
