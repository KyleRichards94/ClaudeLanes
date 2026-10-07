import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  DESIGN_ARTBOARD_LIMIT,
  DesignArtboardSchema,
  err,
  ok,
  type DesignArtboard,
  type DesignArtboardList,
  type DesignCanvasRef,
  type Result,
} from '@agent-lanes/contracts';
import type { ClaudeLauncher } from '../agent/claude-sdk';
import type { TicketRecordStore } from '../tickets';

/**
 * Reads a canvas's artboards (AL-195, D118): a short Agent SDK session on the user's Claude Code
 * claude.ai login (D115), allowed only the tool that reads that kind of canvas, asked for a JSON list.
 *
 * - A Design project is read with the built-in `ClaudeDesign` tool (`list_files`, `read_file`);
 *   a Design artifact with the built-in `Artifact` tool (its files listing). Write operations are
 *   refused in `canUseTool`, so the session can't change the canvas.
 * - When the session's `system/init` does not offer the tool (no claude.ai login, no Design consent,
 *   or the org has it off), the list is `unavailable` with a reason, not an error (D119).
 * - Claude Design pushes no events and polling a model is costly, so the renderer asks again on
 *   design-tab focus and on Refresh.
 */
export interface DesignArtboardReader {
  list(ticketId: string): Promise<Result<DesignArtboardList>>;
}

export interface DesignArtboardReaderOptions {
  claude: ClaudeLauncher;
  tickets: Pick<TicketRecordStore, 'get'>;
  /** The small, fast model the design session uses (Haiku, Decision D10). */
  model?: string;
  /** How long one read may take before it is stopped. */
  timeoutMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}

export const ARTBOARD_READ_MODEL = 'claude-haiku-4-5';
export const ARTBOARD_READ_TIMEOUT_MS = 120_000;

/** ClaudeDesign operations that only read (D116); anything else is refused. */
export const CLAUDE_DESIGN_READ_OPERATIONS = new Set([
  'list',
  'list_design_systems',
  'get_claude_design_prompt',
  'list_projects',
  'get_project',
  'list_files',
  'read_file',
  'get_conversation',
  'list_members',
]);

const TOOL_BY_KIND: Record<DesignCanvasRef['kind'], string> = { 'design-project': 'ClaudeDesign', artifact: 'Artifact' };

export const UNAVAILABLE_REASON =
  "Claude Design isn't available for this Claude login. Sign in to Claude Code with your claude.ai account and allow Design access (run `claude /design login`, or open claude.ai/design/settings).";

const OutputSchema = z.object({ artboards: z.array(DesignArtboardSchema).max(DESIGN_ARTBOARD_LIMIT) });

/** The structured output the session must return. */
const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['artboards'],
  properties: {
    artboards: {
      type: 'array',
      maxItems: DESIGN_ARTBOARD_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'width', 'height'],
        properties: {
          id: { type: 'string', description: "The artboard's file path in the canvas" },
          name: { type: 'string', description: 'The artboard name as the canvas shows it, e.g. "JobControl · desktop"' },
          width: { type: ['integer', 'null'], description: 'Width in pixels, or null when the canvas does not say' },
          height: { type: ['integer', 'null'], description: 'Height in pixels, or null when the canvas does not say' },
        },
      },
    },
  },
} as const;

export function artboardPrompt(canvas: DesignCanvasRef): string {
  const reading =
    canvas.kind === 'design-project'
      ? `Use the ClaudeDesign tool to read the Claude Design project with id "${canvas.id}" (${canvas.url}): list its files with list_files and, where the name or size is not clear from the listing, read a file with read_file.`
      : `Use the Artifact tool to read the Design artifact at ${canvas.url}: list its files and, where the name or size is not clear from the listing, read a file.`;
  return [
    reading,
    'Each artboard (a screen or frame of the design, usually one HTML or JSX file) is one entry. Skip shared assets, styles, scripts and support files.',
    'For each artboard give: id = its file path; name = the artboard name as the canvas shows it; width and height in pixels when the file states them, else null.',
    'Only read. Do not create, change or delete anything. Reply with the JSON only.',
  ].join('\n');
}

export function createDesignArtboardReader(options: DesignArtboardReaderOptions): DesignArtboardReader {
  const now = options.now ?? Date.now;
  const warn = options.warn ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? ARTBOARD_READ_TIMEOUT_MS;

  async function read(canvas: DesignCanvasRef): Promise<Result<DesignArtboardList>> {
    const tool = TOOL_BY_KIND[canvas.kind];
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    let query;
    try {
      query = await options.claude.launch({
        // ClaudeDesign and Artifact need the claude.ai login; an API key can't reach them (D115).
        credential: { mode: 'login' },
        prompt: artboardPrompt(canvas),
        options: {
          model: options.model ?? ARTBOARD_READ_MODEL,
          tools: [tool],
          canUseTool: async (toolName, input) => {
            if (toolName !== tool) return { behavior: 'deny', message: 'Only the design tool may be used here.' };
            if (tool === 'ClaudeDesign' && !CLAUDE_DESIGN_READ_OPERATIONS.has(String(input['operation'] ?? ''))) {
              return { behavior: 'deny', message: 'Listing artboards only reads the canvas.' };
            }
            return { behavior: 'allow', updatedInput: input };
          },
          outputFormat: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA },
          maxTurns: 12,
          persistSession: false,
          settingSources: [],
          abortController,
        },
      });
    } catch (cause) {
      clearTimeout(timer);
      return ok({ status: 'unavailable', reason: cause instanceof Error ? cause.message : String(cause) });
    }

    try {
      for await (const message of query as AsyncIterable<SDKMessage>) {
        if (message.type === 'system' && message.subtype === 'init' && !message.tools.includes(tool)) {
          return ok({ status: 'unavailable', reason: UNAVAILABLE_REASON });
        }
        if (message.type !== 'result') continue;
        if (message.subtype !== 'success' || message.is_error) {
          const detail = message.subtype === 'success' ? message.result : message.subtype;
          return err('INTERNAL', `Couldn't read the canvas's artboards (${detail}).`);
        }
        const parsed = OutputSchema.safeParse(message.structured_output);
        if (!parsed.success) {
          warn(`The design session returned artboards in an unexpected shape: ${parsed.error.issues[0]?.message ?? ''}`);
          return err('INTERNAL', "Couldn't read the canvas's artboards: the reply was not a list.");
        }
        return ok({ status: 'ok', artboards: dedupe(parsed.data.artboards), readAt: now() });
      }
      return err('INTERNAL', abortController.signal.aborted ? 'Reading the artboards took too long.' : 'The design session ended without an answer.');
    } catch (cause) {
      return err('INTERNAL', `Couldn't read the canvas's artboards: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      clearTimeout(timer);
      query.close();
    }
  }

  return {
    async list(ticketId) {
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}`);
      const canvas = record.design.canvas;
      if (!canvas) return ok({ status: 'no-canvas' });
      return read(canvas);
    },
  };
}

/** One entry per id, first wins, in the canvas's order. */
function dedupe(artboards: readonly DesignArtboard[]): DesignArtboard[] {
  const seen = new Set<string>();
  return artboards.filter((artboard) => (seen.has(artboard.id) ? false : (seen.add(artboard.id), true)));
}
