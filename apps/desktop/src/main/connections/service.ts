import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { normalizeOrgUrl } from '@agent-lanes/ado-client';
import {
  ConnectionDraftSchema,
  ConnectionIdSchema,
  ConnectionSummarySchema,
  ReplaceConnectionRequestSchema,
  TestConnectionRequestSchema,
  err,
  ok,
  type ConnectionDraft,
  type ConnectionKind,
  type ConnectionSummary,
  type ConnectionTestResult,
  type Err,
  type RemoveConnectionResult,
  type Result,
} from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import { SecretStoreError, type SecretStore } from '../secrets';
import type { ConnectionsFile } from './connections-file';
import {
  CONNECTIONS_FILE_VERSION,
  isConnectionSecretId,
  maskToken,
  orgNameFromUrl,
  StoredConnectionSchema,
  parseConnectionsDocument,
  scrubSecrets,
  uniqueId,
  type StoredConnection,
} from './records';
import type { ConnectionTestOutcome, ConnectionTesters } from './testers';

/** What the renderer (or a main service) sends; validated again here. */
export type ConnectionDraftInput = z.input<typeof ConnectionDraftSchema>;
export type TestConnectionInput = z.input<typeof TestConnectionRequestSchema>;
export type ReplaceConnectionInput = z.input<typeof ReplaceConnectionRequestSchema>;

/**
 * Azure DevOps organisations, Claude and MCP servers (AL-042, design §8).
 *
 * Records (URL, default project, identity, status, masked token, the SecretStore id of the token)
 * live in `<userData>/connections.json`; tokens go straight from a save request into the SecretStore
 * (AL-040) and come out only through `secret()` and `sessionEnv()`, for other main services.
 * Everything the IPC handlers return is a status row: the token shows as `••••••••7Fq2` at most.
 */
export interface ConnectionsService {
  /** Every connection: ADO organisations by name, then Claude, then MCP servers by name. */
  list(): Promise<ConnectionSummary[]>;
  get(id: string): Promise<ConnectionSummary | undefined>;
  /**
   * Tests a draft (nothing is stored except, for a few minutes, the outcome, so saving the same draft
   * shows it), or a saved connection by id (its row takes the outcome; `connections:changed`).
   */
  test(request: TestConnectionInput): Promise<Result<ConnectionTestResult>>;
  /** Stores the token in the SecretStore and the rest in connections.json. One connection per org / MCP name; one Claude. */
  save(draft: ConnectionDraftInput): Promise<Result<ConnectionSummary>>;
  /** New token and settings for a saved connection, keeping its id and creation time. */
  replace(request: ReplaceConnectionInput): Promise<Result<ConnectionSummary>>;
  /** Deletes the connection and its token. Removing an unknown id resolves `removed: false`. */
  remove(id: string): Promise<Result<RemoveConnectionResult>>;
  /**
   * Main process only, never over IPC: the token saved for a connection, for the service that uses it
   * (the ADO client per org, AL-063; MCP injection, AL-108). Undefined when it has none or it can't be read.
   */
  secret(id: string): Promise<string | undefined>;
  /**
   * Main process only: env vars a new agent session gets from the connections (AL-100), i.e.
   * `ANTHROPIC_API_KEY` while Claude uses an API key. Built from the saved connections at each
   * launch, so once a connection is removed its token is in no later session's env.
   */
  sessionEnv(): Promise<Record<string, string>>;
}

export interface ConnectionsServiceOptions {
  file: ConnectionsFile;
  secrets: SecretStore;
  emit: Emit;
  /** One per kind; AL-043–AL-045 provide them. A kind without one can be saved but not tested. */
  testers?: ConnectionTesters;
  now?: () => Date;
  /** Where start-up problems are reported; the console until the app log exists (AL-214). Never given a token. */
  warn?: (message: string) => void;
}

export const CLAUDE_CONNECTION_ID = 'claude';
export const CLAUDE_API_KEY_SECRET_ID = 'claude:api-key';
/** Env var the Agent SDK's `claude` process reads an API key from (AL-044, AL-100). */
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';

const TEST_TIMEOUT_MS = 60_000;
/** A passing (or failing) draft test is remembered this long, so Save right after Test shows it. */
const DRAFT_TEST_TTL_MS = 15 * 60_000;
const DRAFT_TEST_LIMIT = 16;

export const RECONNECT_MESSAGE = "The saved token can't be read on this computer. Replace it to reconnect.";

const KIND_LABEL: Record<ConnectionKind, string> = { ado: 'Azure DevOps', claude: 'Claude', mcp: 'MCP server' };
const KIND_ORDER: Record<ConnectionKind, number> = { ado: 0, claude: 1, mcp: 2 };

type DraftTester = (draft: ConnectionDraft, signal: AbortSignal) => Promise<ConnectionTestOutcome>;

export function createConnectionsService(options: ConnectionsServiceOptions): ConnectionsService {
  const { file, secrets, emit } = options;
  const testers = options.testers ?? {};
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((message: string) => console.warn(`[connections] ${message}`));

  let records: StoredConnection[] = [];
  /** False while connections.json can't be read (locked, or from a newer app): saving would overwrite it. */
  let writable = true;
  const draftTests = new Map<string, { result: ConnectionTestResult; expires: number }>();

  // Every read and change runs in order behind start-up, so nobody sees records half-way through a save.
  let queue: Promise<unknown> = start();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  // ---- start-up -------------------------------------------------------------------------------

  async function start(): Promise<void> {
    let clean = false;
    try {
      clean = load();
    } catch (cause) {
      records = [];
      writable = false;
      warn(`Could not load ${file.location}: ${describe(cause)}`);
    }
    await reconcileSecrets(clean);
  }

  /** Reads connections.json; true when every record in it was usable (or there is no file yet). */
  function load(): boolean {
    const read = file.read();
    if (read.kind === 'missing') {
      records = [];
      writable = true;
      return true;
    }
    if (read.kind === 'unreadable') {
      records = [];
      writable = read.reason === 'corrupt';
      warn(
        read.reason === 'corrupt'
          ? `${file.location} was corrupt; saved connections are lost and need adding again` + (read.backupPath ? ` (kept as ${read.backupPath}).` : '.')
          : `${file.location} can't be read right now; connections can't be changed until it can.`,
      );
      return false;
    }
    const parsed = parseConnectionsDocument(read.document);
    if (parsed.unsupported) {
      records = [];
      writable = false;
      warn(`${file.location} was written by a newer version of Agent Lanes; it is left as it is and no connections are loaded.`);
      return false;
    }
    records = parsed.connections;
    writable = true;
    if (parsed.dropped > 0) warn(`Dropped ${parsed.dropped} malformed connection record(s) from ${file.location}.`);
    return parsed.dropped === 0;
  }

  /**
   * Deletes tokens no connection refers to (left behind if the app stopped half-way through a save or
   * a remove), but only when connections.json was read cleanly, so a damaged file never costs the
   * user their tokens. Then decrypts each saved token once and drops it, so one that no longer
   * decrypts on this computer shows as "reconnect" before anything needs it.
   */
  async function reconcileSecrets(prune: boolean): Promise<void> {
    const stored = await secrets.list();
    const referenced = new Set(records.flatMap((record) => (record.secretId ? [record.secretId] : [])));
    for (const { id } of stored) {
      if (referenced.has(id)) {
        await secrets.get(id);
      } else if (prune && isConnectionSecretId(id)) {
        try {
          await secrets.delete(id);
          warn(`Deleted the token ${id}: no connection uses it.`);
        } catch (cause) {
          warn(`Could not delete the unused token ${id}: ${describe(cause)}`);
        }
      }
    }
  }

  // ---- helpers --------------------------------------------------------------------------------

  /** A locked file may have been released since start-up: read it again before refusing a change. */
  function ensureWritable(): Err | null {
    if (!writable) {
      try {
        load();
      } catch {
        // still unreadable
      }
    }
    return writable ? null : err('INTERNAL', `${file.location} can't be read right now, so connections were not changed. Try again.`);
  }

  function writeRecords(next: StoredConnection[]): Result<void> {
    if (!writable) return err('INTERNAL', `${file.location} can't be read right now, so connections were not changed.`);
    try {
      file.write({ version: CONNECTIONS_FILE_VERSION, connections: next });
    } catch (cause) {
      return err('INTERNAL', `Could not save connections to ${file.location}: ${describe(cause)}`);
    }
    records = next;
    return ok(undefined);
  }

  function changed(): void {
    emit('connections:changed', {});
  }

  /** Validates a draft and normalises what the user typed (the ADO organisation URL). */
  function parseDraft(input: unknown): Result<ConnectionDraft> {
    const parsed = ConnectionDraftSchema.safeParse(input);
    if (!parsed.success) return err('VALIDATION', 'Invalid connection', parsed.error.issues);
    const draft = parsed.data;
    if (draft.kind === 'ado') {
      const orgUrl = normalizeOrgUrl(draft.orgUrl);
      return orgUrl.ok ? ok({ ...draft, orgUrl: orgUrl.data }) : orgUrl;
    }
    if (draft.kind === 'mcp' && draft.transport.type !== 'stdio') {
      const url = new URL(draft.transport.url);
      if (url.username !== '' || url.password !== '') {
        return err('VALIDATION', "Put the MCP server's token in the token field, not in its URL.");
      }
    }
    return ok(draft);
  }

  function findRecord(id: string): StoredConnection | undefined {
    return records.find((record) => record.id === id);
  }

  function notFound(id: string): Err {
    return err('VALIDATION', `There is no connection ${id}.`, { id });
  }

  /** The saved connection a draft would duplicate: the same organisation, the same MCP name, or any Claude. */
  function duplicateOf(draft: ConnectionDraft, exceptId?: string): StoredConnection | undefined {
    return records.find((record) => {
      if (record.id === exceptId) return false;
      if (record.kind === 'ado' && draft.kind === 'ado') return record.orgUrl.toLowerCase() === draft.orgUrl.toLowerCase();
      if (record.kind === 'mcp' && draft.kind === 'mcp') return record.name.toLowerCase() === draft.name.toLowerCase();
      return record.kind === 'claude' && draft.kind === 'claude';
    });
  }

  function newId(draft: ConnectionDraft): string {
    const taken = new Set(records.map((record) => record.id));
    if (draft.kind === 'claude') return CLAUDE_CONNECTION_ID;
    return draft.kind === 'ado' ? uniqueId('ado', orgNameFromUrl(draft.orgUrl), taken) : uniqueId('mcp', draft.name, taken);
  }

  function secretIdFor(id: string, draft: ConnectionDraft): string {
    return draft.kind === 'claude' ? CLAUDE_API_KEY_SECRET_ID : id;
  }

  /** The record a save or replace writes, checked against the file format before anything is stored. */
  function buildRecord(...args: Parameters<typeof recordFor>): Result<StoredConnection> {
    const record = StoredConnectionSchema.safeParse(recordFor(...args));
    return record.success ? ok(record.data) : err('INTERNAL', 'The connection could not be recorded.', record.error.issues);
  }

  function recordFor(
    id: string,
    draft: ConnectionDraft,
    secretId: string | null,
    previous: StoredConnection | undefined,
    test: ConnectionTestResult | undefined,
  ): StoredConnection {
    const at = now().toISOString();
    const token = tokenOf(draft);
    const common = {
      id,
      secretId,
      identity: test?.identity ?? null,
      maskedToken: token === undefined ? null : maskToken(token),
      expiresAt: draft.expiresAt ?? null,
      status: test?.status ?? 'untested',
      statusMessage: test?.message ?? null,
      lastTestedAt: test?.testedAt ?? null,
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
    } as const;
    switch (draft.kind) {
      case 'ado':
        return {
          ...common,
          kind: 'ado',
          name: orgNameFromUrl(draft.orgUrl),
          orgUrl: draft.orgUrl,
          // Left out of a replace: keep the project already chosen.
          defaultProject: draft.defaultProject !== undefined ? draft.defaultProject : previous?.kind === 'ado' ? previous.defaultProject : null,
          missingScopes: test?.missingScopes ?? [],
        };
      case 'claude':
        return { ...common, kind: 'claude', name: 'Claude', mode: draft.mode };
      case 'mcp':
        return { ...common, kind: 'mcp', name: draft.name, transport: draft.transport };
    }
  }

  async function readable(): Promise<(secretId: string) => boolean> {
    const [present, status] = await Promise.all([secrets.list(), secrets.status()]);
    const ids = new Set(present.map((entry) => entry.id));
    const broken = new Set(status.issues.flatMap((issue) => ('id' in issue ? [issue.id] : [])));
    return (secretId) => ids.has(secretId) && !broken.has(secretId);
  }

  /** The row the renderer gets. Parsed with the contract, so nothing but declared status fields leaves. */
  function toSummary(record: StoredConnection, canRead: (secretId: string) => boolean): ConnectionSummary {
    const needsReconnect = record.secretId !== null && !canRead(record.secretId);
    const row = { ...record, needsReconnect, ...(needsReconnect ? { status: 'error', statusMessage: RECONNECT_MESSAGE } : {}) };
    return ConnectionSummarySchema.parse(row);
  }

  async function summarize(record: StoredConnection): Promise<ConnectionSummary> {
    return toSummary(record, await readable());
  }

  function compareRecords(a: StoredConnection, b: StoredConnection): number {
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1);
  }

  async function putSecret(secretId: string, token: string): Promise<Result<void>> {
    try {
      await secrets.put(secretId, token);
      return ok(undefined);
    } catch (cause) {
      return secretStoreFailure(cause, 'The token could not be saved', [token]);
    }
  }

  /** Best-effort clean-up after a failed change; start-up deletes anything left over. */
  async function deleteSecretQuietly(secretId: string): Promise<void> {
    try {
      await secrets.delete(secretId);
    } catch (cause) {
      warn(`Could not delete the token ${secretId}: ${describe(cause)}`);
    }
  }

  async function restoreSecretQuietly(secretId: string, token: string): Promise<void> {
    try {
      await secrets.put(secretId, token);
    } catch (cause) {
      warn(`Could not restore the previous token ${secretId}: ${describe(cause)}`);
    }
  }

  // ---- testing --------------------------------------------------------------------------------

  function fingerprint(draft: ConnectionDraft): string {
    const parts =
      draft.kind === 'ado'
        ? ['ado', draft.orgUrl.toLowerCase(), draft.pat]
        : draft.kind === 'claude'
          ? ['claude', draft.mode, draft.apiKey ?? '']
          : ['mcp', JSON.stringify(draft.transport), draft.token ?? ''];
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  function rememberDraftTest(draft: ConnectionDraft, result: ConnectionTestResult): void {
    const at = now().getTime();
    for (const [key, entry] of draftTests) if (entry.expires <= at) draftTests.delete(key);
    const key = fingerprint(draft);
    draftTests.delete(key);
    draftTests.set(key, { result, expires: at + DRAFT_TEST_TTL_MS });
    while (draftTests.size > DRAFT_TEST_LIMIT) {
      const oldest = draftTests.keys().next().value;
      if (oldest === undefined) break;
      draftTests.delete(oldest);
    }
  }

  function recalledDraftTest(draft: ConnectionDraft): ConnectionTestResult | undefined {
    const entry = draftTests.get(fingerprint(draft));
    return entry && entry.expires > now().getTime() ? entry.result : undefined;
  }

  async function runTest(draft: ConnectionDraft): Promise<Result<ConnectionTestResult>> {
    const tester = testers[draft.kind] as DraftTester | undefined;
    if (!tester) return err('INTERNAL', `Testing ${KIND_LABEL[draft.kind]} connections isn't available in this version yet.`);

    let outcome: ConnectionTestOutcome;
    try {
      outcome = await tester(draft, AbortSignal.timeout(TEST_TIMEOUT_MS));
    } catch (cause) {
      outcome = { status: 'error', identity: null, message: `The test failed: ${describe(cause)}` };
    }
    const token = [tokenOf(draft)];
    const passed = outcome.status === 'ok';
    return ok({
      status: passed ? 'ok' : 'error',
      identity: outcome.identity ? scrubSecrets(outcome.identity, token) : null,
      message: passed ? null : scrubSecrets(outcome.message || 'The test failed.', token),
      missingScopes: draft.kind === 'ado' ? [...(outcome.missingScopes ?? [])] : [],
      testedAt: now().toISOString(),
    });
  }

  /** The saved connection as a draft with its token, or undefined when the token can't be read. */
  async function draftFromRecord(record: StoredConnection): Promise<ConnectionDraft | undefined> {
    const token = record.secretId ? await secrets.get(record.secretId) : undefined;
    if (record.secretId && token === undefined) return undefined;
    switch (record.kind) {
      case 'ado':
        return token === undefined
          ? undefined
          : { kind: 'ado', orgUrl: record.orgUrl, pat: token, defaultProject: record.defaultProject, expiresAt: record.expiresAt };
      case 'claude':
        return { kind: 'claude', mode: record.mode, ...(token === undefined ? {} : { apiKey: token }), expiresAt: record.expiresAt };
      case 'mcp':
        return { kind: 'mcp', name: record.name, transport: record.transport, ...(token === undefined ? {} : { token }), expiresAt: record.expiresAt };
    }
  }

  function withTest(record: StoredConnection, result: ConnectionTestResult): StoredConnection {
    const tested = {
      status: result.status,
      // A failed test (say a 401) doesn't change who the token belonged to.
      identity: result.identity ?? record.identity,
      statusMessage: result.message,
      lastTestedAt: result.testedAt,
    };
    return record.kind === 'ado' ? { ...record, ...tested, missingScopes: result.missingScopes } : { ...record, ...tested };
  }

  async function testSaved(id: string): Promise<Result<ConnectionTestResult>> {
    const record = await exclusive(async () => findRecord(id));
    if (!record) return notFound(id);
    const draft = await draftFromRecord(record);
    if (!draft) {
      return ok({ status: 'error', identity: null, message: RECONNECT_MESSAGE, missingScopes: [], testedAt: now().toISOString() });
    }

    const result = await runTest(draft);
    if (!result.ok) return result;

    await exclusive(async () => {
      const current = findRecord(id);
      // Replaced or removed while the test ran: this outcome is about a token that is gone.
      if (!current || current.updatedAt !== record.updatedAt) return;
      const written = writeRecords(records.map((item) => (item.id === id ? withTest(current, result.data) : item)));
      if (!written.ok) {
        warn(`Tested ${id} but could not save its status: ${written.message}`);
        return;
      }
      changed();
    });
    return result;
  }

  // ---- the service ----------------------------------------------------------------------------

  return {
    list: () =>
      exclusive(async () => {
        const canRead = await readable();
        return [...records].sort(compareRecords).map((record) => toSummary(record, canRead));
      }),

    get: (id) =>
      exclusive(async () => {
        const record = findRecord(id);
        return record ? summarize(record) : undefined;
      }),

    async test(input) {
      const request = TestConnectionRequestSchema.safeParse(input);
      if (!request.success) return err('VALIDATION', 'Invalid connection test', request.error.issues);
      if ('id' in request.data) return testSaved(request.data.id);

      const draft = parseDraft(request.data.draft);
      if (!draft.ok) return draft;
      const result = await runTest(draft.data);
      if (result.ok) rememberDraftTest(draft.data, result.data);
      return result;
    },

    save: (input) =>
      exclusive(async () => {
        const blocked = ensureWritable();
        if (blocked) return blocked;
        const parsed = parseDraft(input);
        if (!parsed.ok) return parsed;
        const draft = parsed.data;

        const duplicate = duplicateOf(draft);
        if (duplicate) {
          return err('VALIDATION', `${duplicate.name} is already connected; use Replace to change it.`, { id: duplicate.id });
        }

        const id = newId(draft);
        const token = tokenOf(draft);
        const secretId = token === undefined ? null : secretIdFor(id, draft);
        const record = buildRecord(id, draft, secretId, undefined, recalledDraftTest(draft));
        if (!record.ok) return record;
        if (secretId !== null && token !== undefined) {
          const stored = await putSecret(secretId, token);
          if (!stored.ok) return stored;
        }

        const written = writeRecords([...records, record.data]);
        if (!written.ok) {
          if (secretId !== null) await deleteSecretQuietly(secretId);
          return written;
        }
        changed();
        return ok(await summarize(record.data));
      }),

    replace: (input) =>
      exclusive(async () => {
        const blocked = ensureWritable();
        if (blocked) return blocked;
        const request = ReplaceConnectionRequestSchema.safeParse(input);
        if (!request.success) return err('VALIDATION', 'Invalid connection replacement', request.error.issues);
        const existing = findRecord(request.data.id);
        if (!existing) return notFound(request.data.id);
        const parsed = parseDraft(request.data.draft);
        if (!parsed.ok) return parsed;
        const draft = parsed.data;
        if (draft.kind !== existing.kind) {
          return err('VALIDATION', `${existing.name} is a ${KIND_LABEL[existing.kind]} connection; replace it with the same kind.`);
        }
        const duplicate = duplicateOf(draft, existing.id);
        if (duplicate) {
          return err('VALIDATION', `${duplicate.name} is already connected as another connection.`, { id: duplicate.id });
        }

        const token = tokenOf(draft);
        const secretId = token === undefined ? null : (existing.secretId ?? secretIdFor(existing.id, draft));
        const record = buildRecord(existing.id, draft, secretId, existing, recalledDraftTest(draft));
        if (!record.ok) return record;
        // Kept so a failed save can put the old token back.
        let previousToken: string | undefined;
        if (secretId !== null && token !== undefined) {
          if (secretId === existing.secretId) previousToken = await secrets.get(secretId);
          const stored = await putSecret(secretId, token);
          if (!stored.ok) return stored;
        }

        const written = writeRecords(records.map((item) => (item.id === existing.id ? record.data : item)));
        if (!written.ok) {
          if (secretId !== null) {
            await (previousToken === undefined ? deleteSecretQuietly(secretId) : restoreSecretQuietly(secretId, previousToken));
          }
          return written;
        }
        // Claude switched to the Claude Code login, or an MCP server no longer takes a token.
        if (existing.secretId !== null && existing.secretId !== secretId) await deleteSecretQuietly(existing.secretId);
        changed();
        return ok(await summarize(record.data));
      }),

    remove: (id) =>
      exclusive(async (): Promise<Result<RemoveConnectionResult>> => {
        const valid = ConnectionIdSchema.safeParse(id);
        if (!valid.success) return err('VALIDATION', 'Not a connection id', valid.error.issues);
        const blocked = ensureWritable();
        if (blocked) return blocked;
        const existing = findRecord(valid.data);
        if (!existing) return ok({ id: valid.data, removed: false });

        // The token goes first: if that fails, nothing has changed and the user can try again.
        if (existing.secretId !== null) {
          try {
            await secrets.delete(existing.secretId);
          } catch (cause) {
            return secretStoreFailure(cause, `The token for ${existing.name} could not be deleted, so the connection was kept`, []);
          }
        }
        const written = writeRecords(records.filter((item) => item.id !== existing.id));
        if (!written.ok) {
          return err('INTERNAL', `The token for ${existing.name} was deleted, but the connection could not be removed. ${written.message}`);
        }
        changed();
        return ok({ id: existing.id, removed: true });
      }),

    secret: (id) =>
      exclusive(async () => {
        const secretId = findRecord(id)?.secretId;
        return secretId ? secrets.get(secretId) : undefined;
      }),

    sessionEnv: () =>
      exclusive(async (): Promise<Record<string, string>> => {
        const claude = findRecord(CLAUDE_CONNECTION_ID);
        if (claude?.kind !== 'claude' || claude.mode !== 'api-key' || !claude.secretId) return {};
        const apiKey = await secrets.get(claude.secretId);
        return apiKey === undefined ? {} : { [ANTHROPIC_API_KEY_ENV]: apiKey };
      }),
  };
}

/** The token a draft carries, if any. */
function tokenOf(draft: ConnectionDraft): string | undefined {
  switch (draft.kind) {
    case 'ado':
      return draft.pat;
    case 'claude':
      return draft.apiKey;
    case 'mcp':
      return draft.token;
  }
}

/** SecretStore errors never contain the secret (Decision D21); anything else is scrubbed to be sure. */
function secretStoreFailure(cause: unknown, action: string, tokens: string[]): Err {
  if (cause instanceof SecretStoreError) {
    const code = cause.code === 'INVALID_ID' || cause.code === 'INVALID_SECRET' ? 'VALIDATION' : 'INTERNAL';
    return err(code, `${action}. ${cause.message}`, { secretStore: cause.code });
  }
  return err('INTERNAL', scrubSecrets(`${action}: ${describe(cause)}`, tokens));
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
