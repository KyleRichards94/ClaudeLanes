import { z } from 'zod';

/**
 * How a ticket identifies its Claude Design canvas (AL-190 spike, used by AL-193 and later).
 *
 * Two kinds of claude.ai URL can hold a canvas:
 * - a standalone Claude Design project, `https://claude.ai/design/p/<projectId>`, read and written
 *   through the Agent SDK's built-in `ClaudeDesign` tool (project files, previews, design chats);
 * - a Design artifact made from an Artifact type, `https://claude.ai/artifact/<id>` or
 *   `https://claude.ai/code/artifact/<uuid>`, read through the built-in `Artifact` tool.
 *
 * The id is the stable key. The canonical URL is what the webview loads and what
 * "Open in Claude ↗" opens; the last URL the view showed (artboard, zoom) is kept separately by the
 * ticket record so a reopened canvas lands where the user left it.
 */

/** Ids issued by claude.ai: letters, digits, dot, underscore, dash; never starts with a dot. */
const CANVAS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const CanvasIdSchema = z.string().regex(CANVAS_ID_PATTERN);

export const DesignCanvasRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('design-project'),
    id: CanvasIdSchema,
    url: z.string().startsWith('https://claude.ai/design/p/'),
  }),
  z.object({
    kind: z.literal('artifact'),
    id: CanvasIdSchema,
    url: z.string().regex(/^https:\/\/claude\.ai\/(?:code\/)?artifact\//),
  }),
]);
export type DesignCanvasRef = z.infer<typeof DesignCanvasRefSchema>;
export type DesignCanvasKind = DesignCanvasRef['kind'];

// Scheme optional (people paste from the address bar), host claude.ai only, then the canvas path,
// an optional trailing slash, and an optional query or fragment that is dropped from the canonical URL.
const CANVAS_URL_PATTERN = /^(?:https:\/\/)?claude\.ai\/(design\/p|artifact|code\/artifact)\/([^/?#\s]+)\/?(?:[?#]\S*)?$/i;

const KIND_BY_PATH: Record<string, DesignCanvasKind> = {
  'design/p': 'design-project',
  artifact: 'artifact',
  'code/artifact': 'artifact',
};

/**
 * Reads a pasted claude.ai Design URL. Returns undefined for anything that is not a canvas link
 * (chat, project or session links, other hosts, plain http, malformed ids).
 */
export function parseDesignCanvasUrl(input: string): DesignCanvasRef | undefined {
  const match = CANVAS_URL_PATTERN.exec(input.trim());
  if (!match) return undefined;

  const path = match[1]?.toLowerCase() ?? '';
  const id = match[2] ?? '';
  const kind = KIND_BY_PATH[path];
  if (!kind || !CANVAS_ID_PATTERN.test(id)) return undefined;

  return { kind, id, url: `https://claude.ai/${path}/${id}` };
}
