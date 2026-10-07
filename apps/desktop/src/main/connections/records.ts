import { z } from 'zod';
import {
  AdoConnectionSummarySchema,
  AdoScopeCheckSchema,
  ClaudeConnectionSummarySchema,
  MASKED_TOKEN_BULLETS,
  MASKED_TOKEN_VISIBLE_CHARS,
  McpConnectionSummarySchema,
} from '@agent-lanes/contracts';

/**
 * What `<userData>/connections.json` holds (AL-042): one record per connection with everything the
 * list shows, plus `secretId`, the SecretStore id of its token (the "PAT ref"). Never the token: that
 * lives encrypted in `secrets.json` (AL-040). The app is the only writer (R5).
 */
export const CONNECTIONS_FILE_VERSION = 1;

const secretRef = {
  /** SecretStore id of the token (`ado:contoso`, `claude:api-key`, `mcp:github`); null when there is none. */
  secretId: z.string().min(1).nullable(),
};

export const StoredConnectionSchema = z.discriminatedUnion('kind', [
  AdoConnectionSummarySchema.omit({ needsReconnect: true }).extend({
    ...secretRef,
    /**
     * What the last test found per area and access, updated by later calls (AL-043): a write that
     * worked verifies write access, one refused with 403 marks it missing. Kept in the file only;
     * the row shows the outcome as `missingScopes`. Records written before AL-043 have none.
     */
    scopes: z.array(AdoScopeCheckSchema).default([]),
  }),
  ClaudeConnectionSummarySchema.omit({ needsReconnect: true }).extend(secretRef),
  McpConnectionSummarySchema.omit({ needsReconnect: true }).extend(secretRef),
]);
export type StoredConnection = z.infer<typeof StoredConnectionSchema>;

export interface ConnectionsDocument {
  version: typeof CONNECTIONS_FILE_VERSION;
  connections: StoredConnection[];
}

const DocumentShapeSchema = z.object({
  version: z.number(),
  connections: z.array(z.unknown()),
});

export interface ParsedDocument {
  connections: StoredConnection[];
  /** Records that were malformed or repeated an id, and were dropped. */
  dropped: number;
  /** The file is from a newer version of the app, or isn't a connections document at all. */
  unsupported: boolean;
}

/** Keeps every valid record; a malformed one (or a repeated id) is dropped and counted. */
export function parseConnectionsDocument(document: unknown): ParsedDocument {
  const shape = DocumentShapeSchema.safeParse(document);
  if (!shape.success || shape.data.version !== CONNECTIONS_FILE_VERSION) {
    return { connections: [], dropped: 0, unsupported: true };
  }
  const connections: StoredConnection[] = [];
  let dropped = 0;
  for (const item of shape.data.connections) {
    const record = StoredConnectionSchema.safeParse(item);
    if (record.success && !connections.some((existing) => existing.id === record.data.id)) {
      connections.push(record.data);
    } else {
      dropped += 1;
    }
  }
  return { connections, dropped, unsupported: false };
}

/** SecretStore ids this service owns; start-up removes those no connection refers to any more. */
export function isConnectionSecretId(id: string): boolean {
  return /^(?:ado|claude|mcp):/.test(id);
}

/** Tokens shorter than this show bullets only: four characters of a short token give too much away. */
const MIN_LENGTH_TO_SHOW_TAIL = 16;

/** `••••••••7Fq2`: eight bullets and the last four characters, the only part of a token ever shown again. */
export function maskToken(token: string): string {
  return MASKED_TOKEN_BULLETS + (token.length >= MIN_LENGTH_TO_SHOW_TAIL ? token.slice(-MASKED_TOKEN_VISIBLE_CHARS) : '');
}

/**
 * Removes every copy of the given tokens from text that may reach the renderer or a log (a tester's
 * error message, an identity): the raw token, its base64 forms (Basic auth sends `:<pat>`), and its
 * URL-encoded form.
 */
export function scrubSecrets(text: string, secrets: ReadonlyArray<string | undefined>): string {
  let scrubbed = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const forms = new Set([
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret, 'utf8').toString('base64'),
      Buffer.from(`:${secret}`, 'utf8').toString('base64'),
    ]);
    for (const form of [...forms].sort((a, b) => b.length - a.length)) {
      scrubbed = scrubbed.split(form).join(MASKED_TOKEN_BULLETS);
    }
  }
  return scrubbed;
}

/** `CompanionSystems` → `companionsystems`; anything outside `[a-z0-9._-]` becomes `-`. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 56);
  return slug || 'connection';
}

/** `ado:contoso`, or `ado:contoso-2` when another organisation already took the first. */
export function uniqueId(prefix: 'ado' | 'mcp', name: string, taken: ReadonlySet<string>): string {
  const base = `${prefix}:${slugify(name)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The organisation's name from its normalised URL, as artboard 5 shows it:
 * `https://dev.azure.com/CompanionSystems` → `CompanionSystems`, `https://contoso.visualstudio.com`
 * → `contoso`, `https://tfs.example.com/tfs/DefaultCollection` → `DefaultCollection`.
 */
export function orgNameFromUrl(orgUrl: string): string {
  const url = new URL(orgUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last) {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  if (url.hostname.endsWith('.visualstudio.com')) return url.hostname.split('.')[0] ?? url.hostname;
  return url.hostname;
}
