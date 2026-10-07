import type { McpServerConfig, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { STAGES, type TicketRecord } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { ClaudeSdkModule } from '../claude-sdk';
import type { SessionExtras } from '../session-manager';
import { LANE_LABELS } from './stage-rules';
import type { StageService } from './stage-service';

/**
 * The `agent_lanes` MCP server (AL-103, design §7 Stage tracking): an in-process server each ticket
 * session gets, with `set_stage` and `report_activity`. Its tools run in the main process and need
 * no permission prompt.
 */

export const STAGE_SERVER_NAME = 'agent_lanes';
export const STAGE_SERVER_TOOLS = [`mcp__${STAGE_SERVER_NAME}__set_stage`, `mcp__${STAGE_SERVER_NAME}__report_activity`] as const;

/** Appended to Claude Code's system prompt in every ticket session. */
export const STAGE_PROTOCOL = [
  '# Agent Lanes stage protocol',
  'You are running inside Agent Lanes, which shows this ticket as a card moving through the lanes Planning → Implementing → Code review → QA → Create PR.',
  `- Report every stage change with the \`set_stage\` tool of the \`${STAGE_SERVER_NAME}\` MCP server, with a one-line summary, before you start the new stage's work. Its stages are ${STAGES.map((stage) => `"${stage}"`).join(', ')}.`,
  '- Move one stage forward at a time. Code review and QA may send the work back to Implementing when they find problems; call `set_stage` with "implementing" to do so.',
  '- If `set_stage` returns an error, read it: the move did not happen and you are still in the stage you were in.',
  '- Use `report_activity` to say in a few words what you are doing now, with your progress through the current stage as a percentage.',
  '- The ticket starts in Planning: plan the work first, then move to Implementing.',
].join('\n');

/** Said once in the first user turn, so the protocol is in front of the agent from the start. */
export const STAGE_PROTOCOL_REMINDER = `You are in the Planning stage. Report each stage change with ${STAGE_SERVER_TOOLS[0]} as the Agent Lanes stage protocol in your system prompt describes.`;

type ToolResult = Awaited<ReturnType<SdkMcpToolDefinition['handler']>>;

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

/** The server's tools for one ticket. Plain definitions, so tests can call the handlers directly. */
export function stageServerTools(ticketId: string, stages: StageService): SdkMcpToolDefinition<typeof setStageShape | typeof reportActivityShape>[] {
  const setStage: SdkMcpToolDefinition<typeof setStageShape> = {
    name: 'set_stage',
    description:
      'Move this ticket to another Agent Lanes stage (planning, implementing, code-review, qa, create-pr). Call it at every stage change, before starting the new stage. Moves go one step forward; code-review and qa may go back to implementing.',
    inputSchema: setStageShape,
    handler: async ({ stage, summary }) => {
      const moved = await stages.setStage(ticketId, stage, summary);
      if (!moved.ok) return reply(moved.message, true);
      return reply(moved.data.changed ? `Moved to ${LANE_LABELS[moved.data.to]}.` : `The ticket is already in ${LANE_LABELS[moved.data.to]}.`);
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
  return [setStage, reportActivity] as SdkMcpToolDefinition<typeof setStageShape | typeof reportActivityShape>[];
}

export interface StageSessionExtrasOptions {
  stages: StageService;
  /** Builds the in-process server; the SDK's `createSdkMcpServer` by default (tests pass a stand-in). */
  createServer: (tools: SdkMcpToolDefinition<typeof setStageShape | typeof reportActivityShape>[]) => McpServerConfig | Promise<McpServerConfig>;
}

/** The SDK's `createSdkMcpServer`, for `createServer`. */
export function sdkStageServer(loadSdk: () => Promise<ClaudeSdkModule>): StageSessionExtrasOptions['createServer'] {
  return async (tools) => (await loadSdk()).createSdkMcpServer({ name: STAGE_SERVER_NAME, version: '1.0.0', tools, alwaysLoad: true });
}

/**
 * What a ticket session gets for stage tracking: the `agent_lanes` server, its tools allowed without
 * asking, and the protocol. Starting a Queued ticket moves it to Planning.
 */
export function stageSessionExtras(options: StageSessionExtrasOptions): (record: TicketRecord) => Promise<SessionExtras> {
  return async (record) => {
    await options.stages.sessionStarting(record.id);
    return {
      mcpServers: { [STAGE_SERVER_NAME]: await options.createServer(stageServerTools(record.id, options.stages)) },
      allowedTools: [...STAGE_SERVER_TOOLS],
      systemPromptAppend: STAGE_PROTOCOL,
      firstTurnAppendix: [STAGE_PROTOCOL_REMINDER],
    };
  };
}
