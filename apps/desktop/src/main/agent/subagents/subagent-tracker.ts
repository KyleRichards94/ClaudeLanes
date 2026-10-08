import type { HookCallback, HookCallbackMatcher, HookEvent, HookJSONOutput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  EFFORTS,
  SUBAGENT_TEXT_LIMIT,
  SUBAGENT_TREE_LIMIT,
  type AgentSubagents,
  type Effort,
  type Model,
  type SubagentCounts,
  type SubagentNode,
  type SubagentStatus,
} from '@agent-lanes/contracts';
import type { Emit } from '../../ipc/emit';
import type { Logger } from '../../logging';
import { isReadOnlyAgentType } from '../../worktrees/sub-worktree';
import type { SessionManager } from '../session-manager';

/**
 * Sub-agent tracking (AL-107, artboard 3 Sub-agents, design §6 `agent:subagent`). Builds each ticket's
 * sub-agent tree from what its session reports:
 *
 * - the lead agent's Agent/Task tool uses: a node appears as Queued, nested under the sub-agent whose
 *   output carried the tool use (`parent_tool_use_id`);
 * - the SDK's task messages: `task_started` (Running), `task_progress` (one-line activity, tokens),
 *   `task_updated` (status patches), `task_notification` (Done / Failed with its summary and tokens);
 * - the Agent tool's result, for a foreground sub-agent whose task messages never came;
 * - the SubagentStart / SubagentStop hooks, which also give the effort it ran with.
 *
 * Each change is pushed as `agent:subagent` with the node and the ticket's counts, so the card's
 * "N sub-agents" and the panel's "2 running · 1 done · 1 queued" follow the SDK's task states. Writer
 * sub-agents get their sub-branch from the WorktreeCreate hook (AL-084, `noteSubBranch`); branch status
 * (AL-085) asks `isRunning` before calling a sub-branch Ready.
 */
export interface SubagentTracker {
  get(ticketId: string): AgentSubagents;
  counts(ticketId: string): SubagentCounts;
  /** Branch status (AL-085): true while the sub-agent working on sub-branch `name` is queued or running. */
  isRunning(ticketId: string, name: string): boolean;
  /** AL-084's WorktreeCreate hook gave a writer sub-agent this sub-branch (`name` is the hook's name). */
  noteSubBranch(ticketId: string, sub: { name: string; branch: string; agentType?: string; agentId?: string }): void;
  /** The SubagentStart / SubagentStop hooks for a ticket's session. */
  hooks(ticketId: string): Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  dispose(): void;
}

export interface SubagentTrackerOptions {
  sessions: Pick<SessionManager, 'subscribe'>;
  emit: Emit;
  now?: () => number;
  log?: Pick<Logger, 'warn'>;
}

interface Tree {
  nodes: Map<string, SubagentNode>;
  /** SDK task id → node id. */
  byTask: Map<string, string>;
  /** Hook name of each sub-branch → its branch, so a node linked later still finds it. */
  subBranchNames: Map<string, string>;
  leadTokens: number;
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const EMPTY_COUNTS: SubagentCounts = { queued: 0, running: 0, done: 0, failed: 0 };

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > SUBAGENT_TEXT_LIMIT ? `${line.slice(0, SUBAGENT_TEXT_LIMIT - 1)}…` : line;
}

/** `sonnet`, `claude-sonnet-5-5`, `claude-sonnet-5-5-20261001` → `sonnet`; `inherit` and anything else → null. */
export function modelOf(value: unknown): Model | null {
  if (typeof value !== 'string') return null;
  const key = value.toLowerCase();
  for (const model of ['opus', 'sonnet', 'haiku'] as const) {
    if (key === model || key.startsWith(`claude-${model}`)) return model;
  }
  return null;
}

function effortOf(value: unknown): Effort | null {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value) ? (value as Effort) : null;
}

/** The SDK's task states (task_updated patch, task_notification) as the panel's four. */
export function statusOf(sdkStatus: string): SubagentStatus | null {
  switch (sdkStatus) {
    case 'pending':
      return 'queued';
    case 'running':
    case 'paused':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
    case 'killed':
    case 'stopped':
      return 'failed';
    default:
      return null;
  }
}

const FINISHED: ReadonlySet<SubagentStatus> = new Set(['done', 'failed']);

export function countsOf(nodes: Iterable<SubagentNode>): SubagentCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const node of nodes) counts[node.status] += 1;
  return counts;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: unknown) => (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : ''))
    .join(' ');
}

export function createSubagentTracker(options: SubagentTrackerOptions): SubagentTracker {
  const { emit } = options;
  const now = options.now ?? Date.now;
  const trees = new Map<string, Tree>();

  function tree(ticketId: string): Tree {
    let found = trees.get(ticketId);
    if (!found) {
      found = { nodes: new Map(), byTask: new Map(), subBranchNames: new Map(), leadTokens: 0 };
      trees.set(ticketId, found);
    }
    return found;
  }

  /** Keeps the tree bounded: the oldest finished sub-agents go first. */
  function prune(t: Tree): void {
    if (t.nodes.size <= SUBAGENT_TREE_LIMIT) return;
    for (const node of [...t.nodes.values()].filter((entry) => FINISHED.has(entry.status)).sort((a, b) => a.startedAt - b.startedAt)) {
      if (t.nodes.size <= SUBAGENT_TREE_LIMIT) break;
      t.nodes.delete(node.id);
      if (node.taskId) t.byTask.delete(node.taskId);
    }
  }

  function put(ticketId: string, t: Tree, next: SubagentNode, previous: SubagentNode | undefined): void {
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    t.nodes.set(next.id, next);
    if (next.taskId) t.byTask.set(next.taskId, next.id);
    prune(t);
    const change = !previous ? 'started' : FINISHED.has(next.status) && !FINISHED.has(previous.status) ? 'finished' : previous.status === 'queued' && next.status === 'running' ? 'started' : 'updated';
    emit('agent:subagent', { ticketId, change, node: next, counts: countsOf(t.nodes.values()) });
  }

  function update(ticketId: string, nodeId: string | undefined, change: (node: SubagentNode) => SubagentNode): void {
    if (!nodeId) return;
    const t = tree(ticketId);
    const node = t.nodes.get(nodeId);
    if (node) put(ticketId, t, change(node), node);
  }

  function finish(node: SubagentNode, status: SubagentStatus, activity?: string | null): SubagentNode {
    // A finished sub-agent stays finished: late progress frames don't bring it back.
    if (FINISHED.has(node.status)) return node;
    return { ...node, status, endedAt: FINISHED.has(status) ? now() : null, ...(activity ? { activity: clip(activity) } : {}) };
  }

  function nodeForTask(t: Tree, taskId: string, toolUseId: string | undefined): string | undefined {
    return t.byTask.get(taskId) ?? (toolUseId && t.nodes.has(toolUseId) ? toolUseId : undefined);
  }

  function onAssistant(ticketId: string, message: Extract<SDKMessage, { type: 'assistant' }>): void {
    const content: unknown = message.message.content;
    if (!Array.isArray(content)) return;
    const t = tree(ticketId);
    for (const block of content as Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }>) {
      if (block.type !== 'tool_use' || !block.id || !AGENT_TOOLS.has(block.name ?? '') || t.nodes.has(block.id)) continue;
      const input = block.input ?? {};
      const agentType = typeof input['subagent_type'] === 'string' ? input['subagent_type'] : null;
      const name = (typeof input['name'] === 'string' && input['name']) || agentType || 'agent';
      put(
        ticketId,
        t,
        {
          id: block.id,
          taskId: null,
          parentId: message.parent_tool_use_id && t.nodes.has(message.parent_tool_use_id) ? message.parent_tool_use_id : null,
          name: clip(name) || 'agent',
          agentType,
          description: clip(typeof input['description'] === 'string' ? input['description'] : ''),
          model: modelOf(input['model']),
          effort: null,
          status: 'queued',
          activity: null,
          tokens: null,
          branch: null,
          readOnly: isReadOnlyAgentType(agentType ?? name),
          startedAt: now(),
          endedAt: null,
        },
        undefined,
      );
    }
  }

  function onToolResults(ticketId: string, message: Extract<SDKMessage, { type: 'user' }>): void {
    const content: unknown = message.message.content;
    if (!Array.isArray(content)) return;
    for (const block of content as Array<{ type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown }>) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;
      const summary = textOf(block.content).split(/\r?\n/)[0] ?? '';
      // A backgrounded sub-agent's tool result only says it was launched; its task messages finish it.
      if (/^\s*(async agent launched|agent launched in the background|launched)/i.test(summary)) continue;
      update(ticketId, block.tool_use_id, (node) => finish(node, block.is_error ? 'failed' : 'done', summary || null));
    }
  }

  function onSystem(ticketId: string, message: SDKMessage): void {
    if (message.type !== 'system') return;
    const t = tree(ticketId);
    switch (message.subtype) {
      case 'task_started': {
        // Shell, monitor and workflow tasks are not sub-agents.
        if (message.task_type && message.task_type !== 'local_agent' && !message.subagent_type) return;
        const existing = nodeForTask(t, message.task_id, message.tool_use_id);
        if (existing) {
          update(ticketId, existing, (node) => ({
            ...node,
            taskId: message.task_id,
            agentType: node.agentType ?? message.subagent_type ?? null,
            description: node.description || clip(message.description),
            status: FINISHED.has(node.status) ? node.status : 'running',
          }));
          return;
        }
        const parent = message.parent_task_id ? t.byTask.get(message.parent_task_id) : undefined;
        const agentType = message.subagent_type ?? null;
        put(
          ticketId,
          t,
          {
            id: message.tool_use_id ?? message.task_id,
            taskId: message.task_id,
            parentId: parent ?? null,
            name: clip(agentType ?? message.description) || 'agent',
            agentType,
            description: clip(message.description),
            model: null,
            effort: null,
            status: 'running',
            activity: null,
            tokens: null,
            branch: null,
            readOnly: isReadOnlyAgentType(agentType ?? undefined),
            startedAt: now(),
            endedAt: null,
          },
          undefined,
        );
        return;
      }
      case 'task_progress':
        // A finished sub-agent keeps its result line; a late progress frame changes nothing.
        update(ticketId, nodeForTask(t, message.task_id, message.tool_use_id), (node) =>
          FINISHED.has(node.status)
            ? node
            : {
                ...node,
                tokens: message.usage.total_tokens,
                activity: clip(message.summary ?? message.description ?? node.activity ?? ''),
                status: node.status === 'queued' ? 'running' : node.status,
              },
        );
        return;
      case 'task_updated': {
        const status = message.patch.status ? statusOf(message.patch.status) : null;
        update(ticketId, t.byTask.get(message.task_id), (node) => {
          const described = message.patch.description ? { ...node, description: clip(message.patch.description) } : node;
          if (!status) return described;
          return FINISHED.has(status) ? finish(described, status, message.patch.error ?? null) : FINISHED.has(node.status) ? described : { ...described, status };
        });
        return;
      }
      case 'task_notification': {
        const status = statusOf(message.status) ?? 'done';
        update(ticketId, nodeForTask(t, message.task_id, message.tool_use_id), (node) => ({
          ...finish(node, status, message.summary),
          ...(message.usage ? { tokens: message.usage.total_tokens } : {}),
        }));
        return;
      }
      default:
        return;
    }
  }

  function onMessage(ticketId: string, message: SDKMessage): void {
    if (message.type === 'assistant') onAssistant(ticketId, message);
    else if (message.type === 'user') onToolResults(ticketId, message);
    else if (message.type === 'system') onSystem(ticketId, message);
    else if (message.type === 'result') {
      const usage = message.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      tree(ticketId).leadTokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
    }
  }

  const unsubscribe = options.sessions.subscribe(({ ticketId, message }) => {
    try {
      onMessage(ticketId, message);
    } catch (error) {
      options.log?.warn(`Sub-agent tracking failed for ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  /** The node a hook is about: its task id is the hook's agent id; else the oldest waiting node of that type. */
  function nodeForAgent(t: Tree, agentId: string, agentType: string, wanted: ReadonlySet<SubagentStatus>): SubagentNode | undefined {
    const byId = t.nodes.get(t.byTask.get(agentId) ?? '');
    if (byId) return byId;
    return [...t.nodes.values()].find((node) => wanted.has(node.status) && (node.agentType ?? node.name) === agentType);
  }

  return {
    get(ticketId) {
      const t = trees.get(ticketId);
      const nodes = t ? [...t.nodes.values()].sort((a, b) => a.startedAt - b.startedAt) : [];
      return { ticketId, leadTokens: t?.leadTokens ?? 0, nodes, counts: countsOf(nodes) };
    },

    counts: (ticketId) => countsOf(trees.get(ticketId)?.nodes.values() ?? []),

    isRunning(ticketId, name) {
      const t = trees.get(ticketId);
      const branch = t?.subBranchNames.get(name);
      if (!t || !branch) return false;
      return [...t.nodes.values()].some((node) => node.branch === branch && !FINISHED.has(node.status));
    },

    noteSubBranch(ticketId, sub) {
      const t = tree(ticketId);
      t.subBranchNames.set(sub.name, sub.branch);
      const unlinked = (node: SubagentNode) => node.branch === null && !node.readOnly && !FINISHED.has(node.status);
      const byAgent = sub.agentId ? t.nodes.get(t.byTask.get(sub.agentId) ?? '') : undefined;
      const candidates = [...t.nodes.values()].filter(unlinked).sort((a, b) => b.startedAt - a.startedAt);
      // The sub-agent being spawned is the newest one without a worktree, preferring one of the hook's agent type.
      const node =
        (byAgent && unlinked(byAgent) ? byAgent : undefined) ??
        candidates.find((candidate) => sub.agentType !== undefined && (candidate.agentType ?? candidate.name) === sub.agentType) ??
        candidates[0];
      if (node) put(ticketId, t, { ...node, branch: sub.branch }, node);
    },

    hooks(ticketId) {
      const onStart: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== 'SubagentStart') return {};
        const t = tree(ticketId);
        const node = nodeForAgent(t, input.agent_id, input.agent_type, new Set(['queued', 'running']));
        if (node) put(ticketId, t, { ...node, taskId: node.taskId ?? input.agent_id, status: 'running' }, node);
        return {};
      };
      const onStop: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== 'SubagentStop') return {};
        const t = tree(ticketId);
        const node = nodeForAgent(t, input.agent_id, input.agent_type, new Set(['running']));
        if (node) {
          const effort = effortOf(input.effort?.level);
          put(ticketId, t, { ...finish(node, 'done', input.last_assistant_message ?? null), ...(effort ? { effort } : {}) }, node);
        }
        return {};
      };
      return { SubagentStart: [{ hooks: [onStart] }], SubagentStop: [{ hooks: [onStop] }] };
    },

    dispose() {
      unsubscribe();
      trees.clear();
    },
  };
}
