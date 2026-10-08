import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { DESIGN_SPEC_ARTBOARDS_MAX, DESIGN_SPEC_SOURCE_MAX, type DesignCanvasRef } from '@agent-lanes/contracts';
import type { ClaudeLauncher } from '../agent/claude-sdk';
import { ARTBOARD_READ_MODEL, CLAUDE_DESIGN_READ_OPERATIONS } from './artboards';

/**
 * Reads the source of the artboards being shipped (AL-197, AL-190 scope update: ClaudeDesign
 * `read_file` output captured at ship time), through the same kind of short read-only design session
 * as the artboard list (AL-195, D118). Never fails: an artboard whose source can't be read ships with
 * `source: null`, so Approve & ship works at any time (R11) and the agent still gets names, sizes,
 * tokens and the note.
 */
export interface ArtboardSourceReader {
  read(canvas: DesignCanvasRef, artboardIds: readonly string[]): Promise<Map<string, string | null>>;
}

export interface ArtboardSourceReaderOptions {
  claude: ClaudeLauncher;
  model?: string;
  timeoutMs?: number;
  warn?: (message: string) => void;
}

export const ARTBOARD_SOURCE_TIMEOUT_MS = 90_000;

const TOOL_BY_KIND: Record<DesignCanvasRef['kind'], string> = { 'design-project': 'ClaudeDesign', artifact: 'Artifact' };

const OutputSchema = z.object({
  files: z.array(z.object({ id: z.string(), source: z.string().nullable() })).max(DESIGN_SPEC_ARTBOARDS_MAX),
});

const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files'],
  properties: {
    files: {
      type: 'array',
      maxItems: DESIGN_SPEC_ARTBOARDS_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'source'],
        properties: {
          id: { type: 'string', description: 'The file path, exactly as given' },
          source: { type: ['string', 'null'], description: 'The file content as read, or null when it could not be read' },
        },
      },
    },
  },
} as const;

export function artboardSourcePrompt(canvas: DesignCanvasRef, ids: readonly string[]): string {
  const where =
    canvas.kind === 'design-project'
      ? `the Claude Design project with id "${canvas.id}" (${canvas.url}), with the ClaudeDesign tool's read_file operation`
      : `the Design artifact at ${canvas.url}, with the Artifact tool's read path`;
  return [
    `Read these files of ${where}:`,
    ...ids.map((id) => `- ${id}`),
    'Return each file\'s content exactly as read, unchanged, as "source" (null when a file can\'t be read). Only read. Reply with the JSON only.',
  ].join('\n');
}

function clip(source: string): string {
  return source.length > DESIGN_SPEC_SOURCE_MAX ? `${source.slice(0, DESIGN_SPEC_SOURCE_MAX - 40)}\n/* … cut by Agent Lanes: too long */` : source;
}

export function createArtboardSourceReader(options: ArtboardSourceReaderOptions): ArtboardSourceReader {
  const warn = options.warn ?? (() => undefined);
  return {
    async read(canvas, artboardIds) {
      const sources = new Map<string, string | null>(artboardIds.map((id) => [id, null]));
      if (artboardIds.length === 0) return sources;
      const tool = TOOL_BY_KIND[canvas.kind];
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), options.timeoutMs ?? ARTBOARD_SOURCE_TIMEOUT_MS);
      let query;
      try {
        query = await options.claude.launch({
          credential: { mode: 'login' },
          prompt: artboardSourcePrompt(canvas, artboardIds),
          options: {
            model: options.model ?? ARTBOARD_READ_MODEL,
            tools: [tool],
            canUseTool: async (toolName, input) => {
              if (toolName !== tool) return { behavior: 'deny', message: 'Only the design tool may be used here.' };
              if (tool === 'ClaudeDesign' && !CLAUDE_DESIGN_READ_OPERATIONS.has(String(input['operation'] ?? ''))) {
                return { behavior: 'deny', message: 'Shipping a spec only reads the canvas.' };
              }
              return { behavior: 'allow', updatedInput: input };
            },
            outputFormat: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA },
            maxTurns: 4 + artboardIds.length * 2,
            persistSession: false,
            settingSources: [],
            abortController,
          },
        });
      } catch (cause) {
        clearTimeout(timer);
        warn(`Couldn't start the design session to read artboard sources: ${cause instanceof Error ? cause.message : String(cause)}`);
        return sources;
      }
      try {
        for await (const message of query as AsyncIterable<SDKMessage>) {
          if (message.type === 'system' && message.subtype === 'init' && !message.tools.includes(tool)) {
            warn('Claude Design is not available for this Claude login; the spec ships without artboard sources.');
            return sources;
          }
          if (message.type !== 'result') continue;
          const parsed = message.subtype === 'success' && !message.is_error ? OutputSchema.safeParse(message.structured_output) : undefined;
          if (!parsed?.success) {
            warn('The design session did not return the artboard sources; the spec ships without them.');
            return sources;
          }
          for (const file of parsed.data.files) if (sources.has(file.id)) sources.set(file.id, file.source === null ? null : clip(file.source));
          return sources;
        }
        warn(abortController.signal.aborted ? 'Reading the artboard sources took too long; the spec ships without them.' : 'The design session ended without the artboard sources.');
        return sources;
      } catch (cause) {
        warn(`Couldn't read the artboard sources: ${cause instanceof Error ? cause.message : String(cause)}`);
        return sources;
      } finally {
        clearTimeout(timer);
        query.close();
      }
    },
  };
}
