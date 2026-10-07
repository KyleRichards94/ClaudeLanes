import { createHash } from 'node:crypto';
import {
  createAdoClient,
  createPullRequest,
  getPullRequestSnapshot,
  getWorkItem,
  listSprints,
  listSprintWorkItems,
  listWorkItemComments,
  searchWorkItems,
  type AdoClient,
  type AdoLogEntry,
  type FetchLike,
} from '@agent-lanes/ado-client';
import {
  err,
  ok,
  type AdoConnectionSummary,
  type CreatedPullRequest,
  type CreatePullRequestRequest,
  type GetCommentsRequest,
  type GetPullRequestRequest,
  type GetWorkItemRequest,
  type ListSprintsRequest,
  type ListWorkItemsRequest,
  type PullRequestSnapshot,
  type Result,
  type SearchWorkItemsRequest,
  type SprintList,
  type WorkItem,
  type WorkItemComment,
} from '@agent-lanes/contracts';
import type { ConnectionsService } from '../connections';
import type { Logger } from '../logging';
import type { SettingsService } from '../settings/service';
import { createWorkItemWriteBack, type WorkItemWriteBack } from './write-back';

/**
 * Azure DevOps in the main process (AL-065, design §4 "ADO client: REST, PAT/org"). Every `ado:*`
 * channel comes through here: the service picks the organisation's client from its saved connection
 * (AL-042), fills in the default project, and calls the ado-client (AL-061–AL-064). Write-back
 * (AL-063) uses the same clients. The PAT goes from the SecretStore into the client and nowhere
 * else; results carry DTOs and error messages the client has already redacted.
 */
export interface AdoService {
  /**
   * The client for an organisation's connection (`ado:contoso`), or for the first connected
   * organisation when `org` is left out. The token is read from the SecretStore on every call; the
   * client is kept per connection while that token and URL stay the same, so its state-category cache
   * (D186) is reused, and rebuilt as soon as the token is replaced.
   * `ADO_UNAUTHORIZED` (details `reason`): no such organisation (`not-connected`), or its token can't
   * be read on this computer (`reconnect`).
   */
  clientFor(org?: string): Promise<Result<AdoClient>>;
  listSprints(request: ListSprintsRequest): Promise<Result<SprintList>>;
  listWorkItems(request: ListWorkItemsRequest): Promise<Result<WorkItem[]>>;
  searchWorkItems(request: SearchWorkItemsRequest): Promise<Result<WorkItem[]>>;
  getWorkItem(request: GetWorkItemRequest): Promise<Result<WorkItem>>;
  getComments(request: GetCommentsRequest): Promise<Result<WorkItemComment[]>>;
  createPullRequest(request: CreatePullRequestRequest): Promise<Result<CreatedPullRequest>>;
  getPullRequest(request: GetPullRequestRequest): Promise<Result<PullRequestSnapshot>>;
  /** Comments and the settings-gated state change (AL-063), through the same clients. */
  readonly writeBack: WorkItemWriteBack;
}

export interface AdoServiceOptions {
  /** `noteAdoResponse`, when given, records what each answer says about the token's scopes (AL-043). */
  connections: Pick<ConnectionsService, 'list' | 'get' | 'secret'> & Partial<Pick<ConnectionsService, 'noteAdoResponse'>>;
  settings: Pick<SettingsService, 'get'>;
  /** Defaults to the global `fetch`, looked up at call time (D79); tests pass the fake organisation's. */
  fetch?: FetchLike;
  /** Gets the client's redacted per-request lines (`GET … → 200 in 84 ms`). */
  log?: Pick<Logger, 'log'>;
}

/** Why there is no client for an organisation, in `Err.details.reason`. */
export type AdoUnavailableReason = 'not-connected' | 'reconnect';

interface CachedClient {
  /** The organisation URL and a hash of the PAT the client was built with; a replaced token changes it. */
  key: string;
  client: AdoClient;
}

export function createAdoService(options: AdoServiceOptions): AdoService {
  const { connections, settings } = options;
  const clients = new Map<string, CachedClient>();

  function logEntry(entry: AdoLogEntry): void {
    options.log?.log(entry.level, entry.message, { status: entry.status, attempt: entry.attempt, durationMs: entry.durationMs });
  }

  /** Each request's log line, plus its scope evidence on the organisation's connection (AL-043 follow-up). */
  function logFor(connectionId: string): (entry: AdoLogEntry) => void {
    return (entry) => {
      logEntry(entry);
      connections.noteAdoResponse?.(connectionId, entry).catch(() => undefined);
    };
  }

  async function connectionFor(org: string | undefined): Promise<Result<AdoConnectionSummary>> {
    const connection =
      org === undefined
        ? (await connections.list()).find((candidate): candidate is AdoConnectionSummary => candidate.kind === 'ado')
        : await connections.get(org);
    if (connection?.kind !== 'ado') {
      // A connection that went away takes its client with it.
      if (org !== undefined) clients.delete(org);
      return unavailable(
        org === undefined
          ? 'No Azure DevOps organisation is connected. Add one in Connections.'
          : `${org} is not a connected Azure DevOps organisation. Add it in Connections.`,
        'not-connected',
        org,
      );
    }
    if (connection.needsReconnect) {
      clients.delete(connection.id);
      return unavailable(`The token for ${connection.name} can't be read on this computer. Replace it in Connections to reconnect.`, 'reconnect', connection.id);
    }
    return ok(connection);
  }

  async function clientForConnection(connection: AdoConnectionSummary): Promise<Result<AdoClient>> {
    // Read on every call, so a replaced or removed token takes effect at once.
    const pat = await connections.secret(connection.id);
    if (pat === undefined) {
      clients.delete(connection.id);
      return unavailable(`The token for ${connection.name} can't be read on this computer. Replace it in Connections to reconnect.`, 'reconnect', connection.id);
    }
    const key = `${connection.orgUrl}\n${createHash('sha256').update(pat).digest('hex')}`;
    const cached = clients.get(connection.id);
    if (cached?.key === key) return ok(cached.client);

    const created = createAdoClient({ orgUrl: connection.orgUrl, pat, log: logFor(connection.id), ...(options.fetch ? { fetch: options.fetch } : {}) });
    if (!created.ok) return created;
    clients.set(connection.id, { key, client: created.data });
    return created;
  }

  async function clientFor(org?: string): Promise<Result<AdoClient>> {
    const connection = await connectionFor(org);
    return connection.ok ? clientForConnection(connection.data) : connection;
  }

  /** Runs `call` with the organisation's client and, when `needsProject`, the project (the request's or the default). */
  async function withClient<T>(
    request: { org?: string | undefined; project?: string | undefined },
    call: (client: AdoClient, project: string) => Promise<Result<T>>,
    needsProject = true,
  ): Promise<Result<T>> {
    try {
      const connection = await connectionFor(request.org);
      if (!connection.ok) return connection;
      const project = request.project ?? connection.data.defaultProject ?? undefined;
      if (needsProject && project === undefined) {
        return err('VALIDATION', `Choose a default project for ${connection.data.name} in Connections, or say which project to read.`, {
          org: connection.data.id,
          reason: 'no-project',
        });
      }
      const client = await clientForConnection(connection.data);
      if (!client.ok) return client;
      return await call(client.data, project ?? '');
    } catch (cause) {
      return err('INTERNAL', `Azure DevOps request failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  const writeBack = createWorkItemWriteBack({ clientFor: (org) => clientFor(org), settings });

  return {
    clientFor,
    writeBack,

    listSprints: (request) =>
      withClient(request, (client, project) => listSprints(client, { project, ...(request.team === undefined ? {} : { team: request.team }) })),

    listWorkItems: (request) =>
      withClient(request, (client, project) => listSprintWorkItems(client, { project, iterationPath: request.iterationPath })),

    searchWorkItems: (request) =>
      withClient(request, (client, project) =>
        searchWorkItems(client, { project, query: request.query, ...(request.top === undefined ? {} : { top: request.top }) }),
      ),

    // Work items are read at organisation level: no project needed.
    getWorkItem: (request) => withClient(request, (client) => getWorkItem(client, { id: request.id }), false),

    getComments: (request) => withClient(request, (client, project) => listWorkItemComments(client, { project, workItemId: request.workItemId })),

    createPullRequest: ({ org, ...input }) => withClient({ org, project: input.project }, (client) => createPullRequest(client, input)),

    getPullRequest: ({ org, project, repository, pullRequestId }) =>
      withClient({ org, project }, (client) => getPullRequestSnapshot(client, { project, repository, pullRequestId })),
  };
}

function unavailable(message: string, reason: AdoUnavailableReason, org: string | undefined) {
  return err('ADO_UNAUTHORIZED', message, { reason, ...(org === undefined ? {} : { org }) });
}
