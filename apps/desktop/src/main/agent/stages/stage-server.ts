import type { McpServerConfig, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { STAGES, type TicketRecord } from '@agent-lanes/contracts';
import { z } from 'zod';
import { specForAgent, specStatusText, type DesignSpecService } from '../../design/specs';
import type { ClaudeSdkModule } from '../claude-sdk';
import type { SessionExtras } from '../session-manager';
import { LANE_LABELS } from './stage-rules';
import type { StageChange, StageService } from './stage-service';

/**
 * The `agent_lanes` MCP server (AL-103, design §7 Stage tracking): an in-process server each ticket
 * session gets, with `set_stage` and `report_activity`. Its tools run in the main process and need
 * no permission prompt.
 */

export const STAGE_SERVER_NAME = 'agent_lanes';
/** Tool-call timeout of the stage server: 2^31 − 1 ms, the longest a Node timer can wait. */
export const STAGE_TOOL_TIMEOUT_MS = 2_147_483_647;
export const STAGE_SERVER_TOOLS = [`mcp__${STAGE_SERVER_NAME}__set_stage`, `mcp__${STAGE_SERVER_NAME}__report_activity`] as const;
/** The design-spec tools (AL-198), allowed without asking in sessions that have them; sub-agents can call them too. */
export const DESIGN_SPEC_TOOLS = [
  `mcp__${STAGE_SERVER_NAME}__get_design_spec`,
  `mcp__${STAGE_SERVER_NAME}__list_design_specs`,
  `mcp__${STAGE_SERVER_NAME}__ack_design_spec`,
] as const;

/** Appended to Claude Code's system prompt in every ticket session. */
export const STAGE_PROTOCOL = [
  '# Agent Lanes stage protocol',
  'You are running inside Agent Lanes, which shows this ticket as a card moving through the lanes Planning → Implementing → Code review → QA → Create PR.',
  `- Report every stage change with the \`set_stage\` tool of the \`${STAGE_SERVER_NAME}\` MCP server, with a one-line summary, before you start the new stage's work. Its stages are ${STAGES.map((stage) => `"${stage}"`).join(', ')}.`,
  '- Move one stage forward at a time. Code review and QA may send the work back to Implementing when they find problems; call `set_stage` with "implementing" to do so.',
  '- If `set_stage` returns an error, read it: the move did not happen and you are still in the stage you were in.',
  "- Some moves need the user's approval (for example the plan before Implementing, and the PR). Then `set_stage` waits until the user decides; do nothing else meanwhile. If they ask for changes, its result has their note: stay in your stage, make the changes, then call `set_stage` again.",
  '- Use `report_activity` to say in a few words what you are doing now, with your progress through the current stage as a percentage.',
  '- The ticket starts in Planning: plan the work first, then move to Implementing.',
  '',
  '## Design specs',
  `- The user can approve a design on the ticket's Claude Design canvas at any stage and ship it to you as a versioned spec ("Design v2 approved"). When that message arrives, call \`get_design_spec\` of the \`${STAGE_SERVER_NAME}\` MCP server to read it (the latest by default; \`list_design_specs\` lists every version).`,
  '- Follow the spec in the stage you are in: in Planning, fold it into the plan you ask the user to approve; while Implementing, adjust course to it; in Code review and QA, check the work against it.',
  '- A later version supersedes earlier ones: where they differ, follow the latest.',
  '- Once you have taken a spec into account, call `ack_design_spec` with its version and a one-line note, and mention the version ("Design v2") in your next message. Sub-agents that build UI can call `get_design_spec` too.',
].join('\n');

/** Said once in the first user turn, so the protocol is in front of the agent from the start. */
export const STAGE_PROTOCOL_REMINDER = `You are in the Planning stage. Report each stage change with ${STAGE_SERVER_TOOLS[0]} as the Agent Lanes stage protocol in your system prompt describes.`;

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

/** What the agent reads back from `set_stage`, including the user's decision on a gate (AL-104). */
export function setStageReply(change: StageChange): ToolResult {
  const target = LANE_LABELS[change.changed ? change.to : change.from];
  const gate = change.gate;
  if (!gate) return reply(change.changed ? `Moved to ${target}.` : `The ticket is already in ${target}.`);
  const who = gate.by ?? 'The user';
  switch (gate.outcome) {
    case 'approved':
      return reply(`Approved${gate.by ? ` by ${gate.by}` : ' (the user switched the gate off)'}. Moved to ${LANE_LABELS[change.to]}.`);
    case 'changes-requested':
      return reply(`Not approved. ${who} asked for changes before the move:
${gate.note ?? ''}
Stay in ${target}, make the changes, then call set_stage again.`);
    case 'cancelled':
      return reply(`The approval was cancelled because the turn was interrupted or the session stopped. You are still in ${target}.`, true);
  }
}

function reply(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

const setStageShape = {
  stage: z.enum(STAGES).describe('The stage the ticket moves to.'),
  summary: z.string().max(1000).describe('One line on what was done or decided, e.g. "Plan ready: 3 sub-agents, bUnit tests for the filters".'),
};

const reportActivityShape = {
  text: z.string().max(1000).describe('What you are doing now, in a few words, e.g. "Editing JobControl.razor".'),
  progress: z.number().min(0).max(100).optional().describe('Progress through the current stage, 0 to 100.'),
};

const getDesignSpecShape = {
  version: z.int().min(1).optional().describe('The spec version; the latest when left out.'),
};

const listDesignSpecsShape = {};

const ackDesignSpecShape = {
  version: z.int().min(1).describe('The spec version you took into account.'),
  note: z.string().max(1000).describe('One line on how you used it, e.g. "Built JobGrid.razor from JobControl · desktop".'),
};

type StageToolShape = typeof setStageShape | typeof reportActivityShape | typeof getDesignSpecShape | typeof listDesignSpecsShape | typeof ackDesignSpecShape;

/**
 * The design-spec tools for one ticket (AL-198, D16): the agent pulls a shipped spec, which marks it
 * fetched ("Agent is watching this canvas"), and acknowledges it ("Used · 14:01").
 */
export function designSpecTools(ticketId: string, specs: DesignSpecService): SdkMcpToolDefinition<StageToolShape>[] {
  const getSpec: SdkMcpToolDefinition<typeof getDesignSpecShape> = {
    name: 'get_design_spec',
    description:
      "Read a design spec the user shipped to this ticket from its Claude Design canvas: the artboards with their source, the design tokens file and the user's note. The latest version unless you give one.",
    inputSchema: getDesignSpecShape,
    handler: async ({ version }) => {
      const spec = await specs.get(ticketId, version, { fetchedByAgent: true });
      return spec.ok ? reply(specForAgent(spec.data)) : reply(spec.message, true);
    },
  };
  const listSpecs: SdkMcpToolDefinition<typeof listDesignSpecsShape> = {
    name: 'list_design_specs',
    description: 'List the design specs shipped to this ticket, oldest first, with whether each is superseded or acknowledged.',
    inputSchema: listDesignSpecsShape,
    handler: async () => {
      const listed = await specs.list(ticketId);
      if (!listed.ok) return reply(listed.message, true);
      const latest = listed.data.at(-1)?.version;
      if (latest === undefined) return reply('No design has been shipped to this ticket yet.');
      return reply(
        listed.data
          .map((spec) => `v${spec.version} · approved by ${spec.approvedBy} · ${spec.artboardCount} artboard${spec.artboardCount === 1 ? '' : 's'} · ${specStatusText(spec, latest)}`)
          .join('\n'),
      );
    },
  };
  const ackSpec: SdkMcpToolDefinition<typeof ackDesignSpecShape> = {
    name: 'ack_design_spec',
    description: 'Tell Agent Lanes you have taken a design spec into account; the design tab then shows it as Used.',
    inputSchema: ackDesignSpecShape,
    handler: async ({ version, note }) => {
      const acked = await specs.ack(ticketId, version, note);
      return acked.ok ? reply(`Noted: Design v${version} is marked as used.`) : reply(acked.message, true);
    },
  };
  return [getSpec, listSpecs, ackSpec] as SdkMcpToolDefinition<StageToolShape>[];
}

/**
 * The server's tools for one ticket. Plain definitions, so tests can call the handlers directly.
 * With `specs`, the design-spec tools too (AL-198).
 */
export function stageServerTools(ticketId: string, stages: StageService, specs?: DesignSpecService): SdkMcpToolDefinition<StageToolShape>[] {
  const setStage: SdkMcpToolDefinition<typeof setStageShape> = {
    name: 'set_stage',
    description:
      'Move this ticket to another Agent Lanes stage (planning, implementing, code-review, qa, create-pr). Call it at every stage change, before starting the new stage. Moves go one step forward; code-review and qa may go back to implementing.',
    inputSchema: setStageShape,
    handler: async ({ stage, summary }, extra) => {
      // The CLI aborts the call when the turn is interrupted; a gate waiting on it then closes.
      const signal = (extra as { signal?: AbortSignal } | undefined)?.signal;
      const moved = await stages.setStage(ticketId, stage, summary, signal ? { signal } : {});
      if (!moved.ok) return reply(moved.message, true);
      return setStageReply(moved.data);
    },
  };
  const reportActivity: SdkMcpToolDefinition<typeof reportActivityShape> = {
    name: 'report_activity',
    description: "Update the ticket card's activity line and progress bar on the Agent Lanes board.",
    inputSchema: reportActivityShape,
    handler: async ({ text, progress }) => {
      const reported = await stages.reportActivity(ticketId, text, progress === undefined ? null : progress / 100);
      return reported.ok ? reply('Noted.') : reply(reported.message, true);
    },
  };
  return [setStage, reportActivity, ...(specs ? designSpecTools(ticketId, specs) : [])] as SdkMcpToolDefinition<StageToolShape>[];
}

export interface StageSessionExtrasOptions {
  stages: StageService;
  /** The ticket's shipped design specs (AL-198); without it the session has no design-spec tools. */
  designSpecs?: DesignSpecService;
  /** Builds the in-process server; the SDK's `createSdkMcpServer` by default (tests pass a stand-in). */
  createServer: (tools: SdkMcpToolDefinition<StageToolShape>[]) => McpServerConfig | Promise<McpServerConfig>;
}

/** The SDK's `createSdkMcpServer`, for `createServer`. */
export function sdkStageServer(loadSdk: () => Promise<ClaudeSdkModule>): StageSessionExtrasOptions['createServer'] {
  // A gate can wait for hours: the longest timer Node allows (about 24 days), whatever MCP_TOOL_TIMEOUT says.
  return async (tools) => (await loadSdk()).createSdkMcpServer({ name: STAGE_SERVER_NAME, version: '1.0.0', tools, alwaysLoad: true, timeout: STAGE_TOOL_TIMEOUT_MS });
}

/**
 * What a ticket session gets for stage tracking: the `agent_lanes` server, its tools allowed without
 * asking, and the protocol. Starting a Queued ticket moves it to Planning.
 */
export function stageSessionExtras(options: StageSessionExtrasOptions): (record: TicketRecord) => Promise<SessionExtras> {
  return async (record) => {
    await options.stages.sessionStarting(record.id);
    return {
      mcpServers: { [STAGE_SERVER_NAME]: await options.createServer(stageServerTools(record.id, options.stages, options.designSpecs)) },
      allowedTools: [...STAGE_SERVER_TOOLS, ...(options.designSpecs ? DESIGN_SPEC_TOOLS : [])],
      systemPromptAppend: STAGE_PROTOCOL,
      firstTurnAppendix: [STAGE_PROTOCOL_REMINDER],
    };
  };
}
