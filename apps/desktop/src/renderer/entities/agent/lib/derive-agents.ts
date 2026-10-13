import type { AgentOutputEvent, AgentSessionState, Model, SubagentNode, TicketCompanionRole } from '@agent-lanes/contracts';
import { MODEL_LABELS } from '@/shared/config';
import { deriveActivity, type AgentActivityKind } from './activity';
import { agentColor, assignAgentColors } from './colors';

export type AgentRole = 'lead' | 'sub' | 'reviewer' | 'helper';
export type AgentStatus = 'running' | 'idle' | 'done' | 'error';

/** One agent of a ticket as both layouts draw it (AL-278): the lead, a sub-agent, or a second agent. */
export interface AgentView {
  /** The ticket id for the lead; a sub-agent's tool use id (`SubagentNode.id`); a second agent's own ticket id. Same ids as `ChangedFile.authorAgentId`. */
  readonly id: string;
  readonly name: string;
  readonly role: AgentRole;
  /** "Opus", "Sonnet": its own model, or the lead's when it inherits it; null when unknown. */
  readonly model: string | null;
  /** Assigned once, in spawn order, the same in both layouts. */
  readonly color: string;
  readonly status: AgentStatus;
  /** The file it is reading, editing or reviewing right now; null when it is on no file or not running. */
  readonly activeFile: string | null;
  readonly activeKind: AgentActivityKind;
  /** When that activity happened (epoch ms), so Follow agent can pick the most recent; null when idle. */
  readonly activeAt: number | null;
  readonly tokens: number | null;
  readonly branch: string | null;
}

export interface LeadAgentInput {
  /** The ticket id. */
  readonly id: string;
  readonly model: Model;
  readonly branch: string;
  readonly session: AgentSessionState;
  readonly tokens?: number | null;
}

export interface CompanionAgentInput {
  /** The second agent's own ticket id. */
  readonly id: string;
  readonly name: string;
  readonly role: TicketCompanionRole;
  readonly model: Model;
  readonly branch: string | null;
  readonly session: AgentSessionState;
  /** When it was added; spawn order for its colour. */
  readonly startedAt: number;
}

export interface DeriveAgentsInput {
  readonly lead: LeadAgentInput;
  readonly subAgents: readonly SubagentNode[];
  readonly companions?: readonly CompanionAgentInput[];
  /** The lead's output events plus each second agent's: a sub-agent's are in the lead's. */
  readonly events: readonly AgentOutputEvent[];
}

/** A session's state as the agent's status: working, waiting for input or a slot, finished, or lost. */
export function sessionStatus(state: AgentSessionState): AgentStatus {
  switch (state) {
    case 'running':
    case 'starting':
      return 'running';
    case 'stopped':
      return 'done';
    case 'lost':
      return 'error';
    default:
      return 'idle';
  }
}

/** A sub-agent's state as the agent's status: queued waits (idle), failed is an error. */
export function subAgentStatus(status: SubagentNode['status']): AgentStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'done':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return 'idle';
  }
}

const REVIEWER_TYPES = /^(?:reviewer|code-reviewer|review)$|-reviewer$/;

/** Whether a sub-agent reviews rather than writes, from its agent type or name. */
export function isReviewerNode(node: Pick<SubagentNode, 'agentType' | 'name'>): boolean {
  return REVIEWER_TYPES.test((node.agentType ?? node.name).trim().toLowerCase());
}

/**
 * The agents of a ticket, lead first then sub-agents and second agents in spawn order, each with its colour,
 * status and what it is doing to which file. Pure: the caller (`useAgents` in `features/ticket-insight`) gathers
 * the inputs. A reviewer's `read` and `edit` read as `review`; an agent that is not running has no active file.
 */
export function deriveAgents({ lead, subAgents, companions = [], events }: DeriveAgentsInput): AgentView[] {
  const colors = assignAgentColors([
    ...subAgents.map((node) => ({ id: node.id, startedAt: node.startedAt })),
    ...companions.map((companion) => ({ id: companion.id, startedAt: companion.startedAt })),
  ]);
  const activity = deriveActivity(events);
  const leadModel = MODEL_LABELS[lead.model];

  const view = (
    base: Pick<AgentView, 'id' | 'name' | 'role' | 'model' | 'color' | 'status' | 'tokens' | 'branch'>,
  ): AgentView => {
    const current = base.status === 'running' ? activity.get(base.id) : undefined;
    const reviewing = base.role === 'reviewer' && (current?.kind === 'read' || current?.kind === 'edit');
    return {
      ...base,
      activeFile: current?.file ?? null,
      activeKind: current ? (reviewing ? 'review' : current.kind) : 'idle',
      activeAt: current?.at ?? null,
    };
  };

  const agents: AgentView[] = [
    view({
      id: lead.id,
      name: 'Lead',
      role: 'lead',
      model: leadModel,
      color: agentColor('lead'),
      status: sessionStatus(lead.session),
      tokens: lead.tokens ?? null,
      branch: lead.branch,
    }),
  ];

  const others: { startedAt: number; agent: AgentView }[] = [
    ...subAgents.map((node) => ({
      startedAt: node.startedAt,
      agent: view({
        id: node.id,
        name: node.name,
        role: isReviewerNode(node) ? ('reviewer' as const) : ('sub' as const),
        model: node.model ? MODEL_LABELS[node.model] : leadModel,
        color: colors.get(node.id) ?? agentColor('sub'),
        status: subAgentStatus(node.status),
        tokens: node.tokens,
        branch: node.branch,
      }),
    })),
    ...companions.map((companion) => ({
      startedAt: companion.startedAt,
      agent: view({
        id: companion.id,
        name: companion.name,
        role: companion.role,
        model: MODEL_LABELS[companion.model],
        color: colors.get(companion.id) ?? agentColor('sub'),
        status: sessionStatus(companion.session),
        tokens: null,
        branch: companion.branch,
      }),
    })),
  ];
  others.sort((a, b) => a.startedAt - b.startedAt || a.agent.id.localeCompare(b.agent.id));
  return [...agents, ...others.map((entry) => entry.agent)];
}

/**
 * The file Follow agent should show: where a running agent last edited or reviewed (the newest one when several
 * are at work); null when none is on a file.
 */
export function latestActiveFile(agents: readonly AgentView[]): string | null {
  let best: AgentView | undefined;
  for (const agent of agents) {
    if (agent.status !== 'running' || agent.activeFile === null || (agent.activeKind !== 'edit' && agent.activeKind !== 'review')) continue;
    if (!best || (agent.activeAt ?? 0) > (best.activeAt ?? 0)) best = agent;
  }
  return best?.activeFile ?? null;
}

/** The agent with this id, for a file's author or a pin; undefined when it is not (or no longer) among them. */
export function agentById(agents: readonly AgentView[], id: string | null | undefined): AgentView | undefined {
  return id == null ? undefined : agents.find((agent) => agent.id === id);
}
