import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { EventEnvelopeSchema } from '../events';
import { ClaudeLoginDetectionSchema } from './connections.claude';
import type { CONNECTIONS_EVENT_CHANNELS, CONNECTIONS_INVOKE_CHANNELS } from './connections.names';

/**
 * Connections (AL-042, design §8, R4): Azure DevOps organisations, Claude, and MCP servers.
 *
 * Only two requests carry a token, `connections:save` and `connections:replace`: the token the user
 * typed goes straight into the main process's SecretStore. Nothing that comes back carries one.
 * Rows show `maskedToken`, which this contract limits to eight bullets and at most the last four
 * characters (`••••••••7Fq2`), so a full token cannot fit in it; no-secret-fields.test.ts checks
 * that no response or event field is named like a secret.
 */

export const CONNECTION_KINDS = ['ado', 'claude', 'mcp'] as const;
export const ConnectionKindSchema = z.enum(CONNECTION_KINDS);
export type ConnectionKind = z.infer<typeof ConnectionKindSchema>;

/** `ok`: the last test passed. `error`: it failed, or the saved token can't be read. `untested`: saved without a test. */
export const CONNECTION_STATUSES = ['ok', 'error', 'untested'] as const;
export const ConnectionStatusSchema = z.enum(CONNECTION_STATUSES);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** PAT areas the ADO test checks (design §8, AL-043): the Work Items, Code and Build chips on artboard 5. */
export const ADO_SCOPES = ['work-items', 'code', 'build'] as const;
export const AdoScopeSchema = z.enum(ADO_SCOPES);
export type AdoScope = z.infer<typeof AdoScopeSchema>;

/** Claude signs in with the user's existing Claude Code login, or an API key given to sessions as `ANTHROPIC_API_KEY` (Q4, AL-044). */
export const CLAUDE_AUTH_MODES = ['login', 'api-key'] as const;
export const ClaudeAuthModeSchema = z.enum(CLAUDE_AUTH_MODES);
export type ClaudeAuthMode = z.infer<typeof ClaudeAuthModeSchema>;

/**
 * `ado:<org>` and `mcp:<name>` (lowercase slugs the main process derives from the org URL or the
 * server name), or `claude`: there is one Claude connection.
 */
export const ConnectionIdSchema = z
  .string()
  .regex(/^(?:(?:ado|mcp):[a-z0-9][a-z0-9._-]{0,63}|claude)$/, 'Not a connection id');
export type ConnectionId = z.infer<typeof ConnectionIdSchema>;

/** Eight bullets, then the token's last characters (none for a short token). */
export const MASKED_TOKEN_BULLETS = '•'.repeat(8);
/** The most characters of a token any response shows. */
export const MASKED_TOKEN_VISIBLE_CHARS = 4;
export const MaskedTokenSchema = z
  .string()
  .regex(/^•{8}[\x21-\x7e]{0,4}$/, 'A masked token is eight bullets and at most the last four characters');

/** A date the user entered for when the token expires (Q10; ADO does not tell a PAT its own expiry). */
export const ExpiryDateSchema = z.iso.date();

/** Environment variable a stdio MCP server reads its token from, e.g. `GITHUB_PERSONAL_ACCESS_TOKEN`. */
export const EnvVarNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, 'Not an environment variable name');

/** HTTP header an HTTP or SSE MCP server reads its token from (RFC 9110 token characters). */
export const HeaderNameSchema = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/, 'Not an HTTP header name');

/** An MCP server started as a child process (AL-045). */
export const McpStdioTransportSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().trim().min(1).max(4096),
  args: z.array(z.string().max(4096)).max(64),
  /** Where the server gets its token when it starts; null when it takes none. */
  envVar: EnvVarNameSchema.nullable(),
});

/** An MCP server reached over HTTP (streamable) or SSE (AL-045). */
export const McpRemoteTransportSchema = z.object({
  type: z.enum(['http', 'sse']),
  url: z.url({ protocol: /^https?$/ }).max(2048),
  /** Header that carries the token; null when the server takes none. */
  header: HeaderNameSchema.nullable(),
});

export const McpTransportSchema = z.discriminatedUnion('type', [McpStdioTransportSchema, McpRemoteTransportSchema]);
export type McpTransport = z.infer<typeof McpTransportSchema>;

// ---------------------------------------------------------------------------------------------
// Rows: what `connections:list`, `connections:save` and `connections:replace` return.

const ConnectionRowSchema = z.object({
  id: ConnectionIdSchema,
  /** The organisation (`CompanionSystems`), `Claude`, or the MCP server's name. */
  name: z.string().min(1),
  /** Who the last passing test signed in as ("Kyle Richards", a Claude account); null until then. */
  identity: z.string().nullable(),
  /** `••••••••7Fq2`; null when the connection holds no token (Claude login, an MCP server without one). */
  maskedToken: MaskedTokenSchema.nullable(),
  expiresAt: ExpiryDateSchema.nullable(),
  status: ConnectionStatusSchema,
  /** Why the status is `error`, in words the modal can show; null otherwise. */
  statusMessage: z.string().nullable(),
  /**
   * The saved token is missing or no longer decrypts on this computer (e.g. a corrupt secrets file,
   * AL-040), so the row shows `error` and asks the user to Replace the token.
   */
  needsReconnect: z.boolean(),
  lastTestedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const AdoConnectionSummarySchema = ConnectionRowSchema.extend({
  kind: z.literal('ado'),
  /** Normalised, e.g. `https://dev.azure.com/CompanionSystems`. */
  orgUrl: z.string().min(1),
  defaultProject: z.string().min(1).nullable(),
  /** Scopes the last test found missing; empty when untested or when all are there. */
  missingScopes: z.array(AdoScopeSchema),
});
export type AdoConnectionSummary = z.infer<typeof AdoConnectionSummarySchema>;

export const ClaudeConnectionSummarySchema = ConnectionRowSchema.extend({
  kind: z.literal('claude'),
  mode: ClaudeAuthModeSchema,
});
export type ClaudeConnectionSummary = z.infer<typeof ClaudeConnectionSummarySchema>;

export const McpConnectionSummarySchema = ConnectionRowSchema.extend({
  kind: z.literal('mcp'),
  transport: McpTransportSchema,
});
export type McpConnectionSummary = z.infer<typeof McpConnectionSummarySchema>;

/** One connection as the renderer sees it: status and identity, never the token (design §8). */
export const ConnectionSummarySchema = z.discriminatedUnion('kind', [
  AdoConnectionSummarySchema,
  ClaudeConnectionSummarySchema,
  McpConnectionSummarySchema,
]);
export type ConnectionSummary = z.infer<typeof ConnectionSummarySchema>;

// ---------------------------------------------------------------------------------------------
// Drafts: what the user typed in a row of the modal. These carry the token, in requests only.

/** A token as pasted: surrounding whitespace dropped, then printable ASCII with no spaces. */
const TokenInputSchema = z
  .string()
  .trim()
  .min(1, 'Enter the token')
  .max(16 * 1024, 'The token is too long')
  .regex(/^[\x21-\x7e]+$/, 'A token has no spaces or non-ASCII characters');

const OptionalExpirySchema = ExpiryDateSchema.nullable().optional();

export const AdoConnectionDraftSchema = z.strictObject({
  kind: z.literal('ado'),
  /** As typed; main normalises it (`https://dev.azure.com/contoso/` → `https://dev.azure.com/contoso`). */
  orgUrl: z.string().trim().min(1).max(2048),
  pat: TokenInputSchema,
  defaultProject: z.string().trim().min(1).max(256).nullable().optional(),
  expiresAt: OptionalExpirySchema,
});
export type AdoConnectionDraft = z.infer<typeof AdoConnectionDraftSchema>;

export const ClaudeConnectionDraftSchema = z
  .strictObject({
    kind: z.literal('claude'),
    mode: ClaudeAuthModeSchema,
    /** Required with mode `api-key`, refused with `login`. */
    apiKey: TokenInputSchema.optional(),
    expiresAt: OptionalExpirySchema,
  })
  .refine((draft) => (draft.mode === 'api-key') === (draft.apiKey !== undefined), {
    message: 'An API key goes with mode api-key, and only with it',
    path: ['apiKey'],
  });
export type ClaudeConnectionDraft = z.infer<typeof ClaudeConnectionDraftSchema>;

export const McpConnectionDraftSchema = z
  .strictObject({
    kind: z.literal('mcp'),
    name: z.string().trim().min(1).max(64),
    transport: McpTransportSchema,
    token: TokenInputSchema.optional(),
    expiresAt: OptionalExpirySchema,
  })
  .refine((draft) => draft.token === undefined || (draft.transport.type === 'stdio' ? draft.transport.envVar : draft.transport.header) !== null, {
    message: 'Say which environment variable or header the token goes in',
    path: ['transport'],
  });
export type McpConnectionDraft = z.infer<typeof McpConnectionDraftSchema>;

export const ConnectionDraftSchema = z.discriminatedUnion('kind', [
  AdoConnectionDraftSchema,
  ClaudeConnectionDraftSchema,
  McpConnectionDraftSchema,
]);
/** A draft after validation (trimmed); `z.input` is what the renderer sends. */
export type ConnectionDraft = z.infer<typeof ConnectionDraftSchema>;

// ---------------------------------------------------------------------------------------------
// Channels.

/** Test a draft before saving it, or re-test a saved connection by id (which updates its row). */
export const TestConnectionRequestSchema = z.union([
  z.strictObject({ draft: ConnectionDraftSchema }),
  z.strictObject({ id: ConnectionIdSchema }),
]);
export type TestConnectionRequest = z.infer<typeof TestConnectionRequestSchema>;

export const ConnectionTestResultSchema = z.object({
  status: z.enum(['ok', 'error']),
  /** Who the token signs in as, when the test got that far. */
  identity: z.string().nullable(),
  /** What went wrong, for the row; null when the test passed. */
  message: z.string().nullable(),
  /** ADO only (AL-043); always empty for Claude and MCP servers. */
  missingScopes: z.array(AdoScopeSchema),
  testedAt: z.iso.datetime(),
});
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;

/** Replace a saved connection's token and settings, keeping its id; the draft's kind must match. */
export const ReplaceConnectionRequestSchema = z.strictObject({
  id: ConnectionIdSchema,
  draft: ConnectionDraftSchema,
});
export type ReplaceConnectionRequest = z.infer<typeof ReplaceConnectionRequestSchema>;

export const RemoveConnectionRequestSchema = z.strictObject({ id: ConnectionIdSchema });
export const RemoveConnectionResultSchema = z.object({
  id: ConnectionIdSchema,
  /** False when there was no such connection (removing twice is not an error). */
  removed: z.boolean(),
});
export type RemoveConnectionResult = z.infer<typeof RemoveConnectionResultSchema>;

export const connectionsInvokeContracts = {
  /** Every connection: ADO organisations by name, then Claude, then MCP servers by name. */
  'connections:list': { request: z.undefined(), response: z.array(ConnectionSummarySchema) },
  'connections:test': { request: TestConnectionRequestSchema, response: ConnectionTestResultSchema },
  'connections:save': { request: ConnectionDraftSchema, response: ConnectionSummarySchema },
  'connections:replace': { request: ReplaceConnectionRequestSchema, response: ConnectionSummarySchema },
  'connections:remove': { request: RemoveConnectionRequestSchema, response: RemoveConnectionResultSchema },
  /** Looks for a Claude Code login on this computer, for "Use my Claude Code login" (AL-044). Sends no prompt. */
  'connections:detectClaude': { request: z.undefined(), response: ClaudeLoginDetectionSchema },
} as const satisfies Record<(typeof CONNECTIONS_INVOKE_CHANNELS)[number], InvokeContract>;

/**
 * `connections:changed`: a connection was saved, replaced, removed or re-tested, so the renderer
 * refetches `connections:list` (AL-042). Status only, never a secret (design §8).
 */
export const ConnectionsChangedEventSchema = EventEnvelopeSchema.extend({});
export type ConnectionsChangedEvent = z.infer<typeof ConnectionsChangedEventSchema>;

export const connectionsEventContracts = {
  'connections:changed': ConnectionsChangedEventSchema,
} as const satisfies Record<(typeof CONNECTIONS_EVENT_CHANNELS)[number], z.ZodType>;
