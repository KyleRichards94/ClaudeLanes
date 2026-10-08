import { createHash } from 'node:crypto';
import {
  createAdoClient,
  createPullRequest,
  getBacklog,
  getPullRequestSnapshot,
  getTeamBoard,
  getWorkItem,
  getWorkItemColors,
  listActivePullRequests,
  listMyTeams,
  listSprints,
  listSprintWorkItems,
  listWorkItemComments,
  searchWorkItems,
  type AdoClient,
  type AdoGitRemote,
  type AdoLogEntry,
  type FetchLike,
} from '@agent-lanes/ado-client';
import {
  err,
  ok,
  type ActivePrsRequest,
  type ActivePullRequestList,
  type BacklogPage,
  type BacklogRequest,
  type AdoConnectionSummary,
  type CreatedPullRequest,
  type CreatePullRequestRequest,
  type GetCommentsRequest,
  type GetPullRequestRequest,
  type GetWorkItemRequest,
  type ListSprintsRequest,
  type ListTeamsRequest,
  type ListWorkItemsRequest,
  type PullRequestSnapshot,
  type Result,
  type SearchWorkItemsRequest,
  type SprintList,
  type TeamBoard,
  type TeamBoardRequest,
  type TeamList,
  type WorkItem,
  type WorkItemColors,
  type WorkItemColorsRequest,
  type WorkItemComment,
} from '@agent-lanes/contracts';
import type { ConnectionsService } from '../connections';
import type { Logger } from '../logging';
import type { SettingsService } from '../settings/service';
import { isRegisteredRepository } from './registered-repos';
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
  /** The user's teams and the default one, for the team board's dropdown (AL-231). */
  listTeams(request: ListTeamsRequest): Promise<Result<TeamList>>;
  /** A team's ADO board for one sprint (AL-231). */
  teamBoard(request: TeamBoardRequest): Promise<Result<TeamBoard>>;
  /** The team's open pull requests with unresolved thread counts; unregistered repos flagged (AL-232). */
  activePrs(request: ActivePrsRequest): Promise<Result<ActivePullRequestList>>;
  /** One page of the team's backlog, grouped by Feature, filtered in WIQL (AL-233). */
  backlog(request: BacklogRequest): Promise<Result<BacklogPage>>;
  /** The project's work item type and state colours, kept for {@link WORK_ITEM_COLORS_TTL_MS} per organisation and project. */
  workItemColors(request: WorkItemColorsRequest): Promise<Result<WorkItemColors>>;
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
  /** Azure DevOps answered 401 for this connection's token (AL-048: the org turns red and its agents pause). */
  onUnauthorized?: (connectionId: string) => void;
  /** The Azure Repos remotes of the repos registered in Agent Lanes (AL-232). Default: none. */
  registeredRemotes?: () => Promise<AdoGitRemote[]>;
  /** Clock for the resolved-team cache. Defaults to `Date.now`. */
  now?: () => number;
}

/** Why there is no client for an organisation, in `Err.details.reason`. */
export type AdoUnavailableReason = 'not-connected' | 'reconnect';

/** How long a team resolved for a request without one is reused, per organisation and project. */
export const RESOLVED_TEAM_TTL_MS = 5 * 60_000;

/** How long a project's work item colours are reused: they change only when someone edits the process. */
export const WORK_ITEM_COLORS_TTL_MS = 30 * 60_000;

interface CachedClient {
  /** The organisation URL and a hash of the PAT the client was built with; a replaced token changes it. */
  key: string;
  client: AdoClient;
}

interface CachedColors {
  /** Shared by concurrent callers; a failed read is dropped so the next call tries again. */
  colors: Promise<Result<WorkItemColors>>;
  expiresAt: number;
}

interface ResolvedTeam {
  teamId: string;
  expiresAt: number;
}

export function createAdoService(options: AdoServiceOptions): AdoService {
  const { connections, settings } = options;
  const clients = new Map<string, CachedClient>();
  const resolvedTeams = new Map<string, ResolvedTeam>();
  const colorCache = new Map<string, CachedColors>();
  const now = options.now ?? Date.now;

  function logEntry(entry: AdoLogEntry): void {
    options.log?.log(entry.level, entry.message, { status: entry.status, attempt: entry.attempt, durationMs: entry.durationMs });
  }

  /** Each request's log line, plus its scope evidence on the organisation's connection (AL-043 follow-up). */
  function logFor(connectionId: string): (entry: AdoLogEntry) => void {
    return (entry) => {
      logEntry(entry);
      connections.noteAdoResponse?.(connectionId, entry).catch(() => undefined);
      if (entry.status === 401) options.onUnauthorized?.(connectionId);
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
    call: (client: AdoClient, project: string, connection: AdoConnectionSummary) => Promise<Result<T>>,
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
      return await call(client.data, project ?? '', connection.data);
    } catch (cause) {
      return err('INTERNAL', `Azure DevOps request failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /**
   * The team a team-scoped request reads: the request's own, else the user's default team in the
   * project (`listMyTeams`: the project's default team when the user is in it, else their first
   * team), kept for {@link RESOLVED_TEAM_TTL_MS} per organisation and project. Azure DevOps Server
   * answers the project-level team settings routes with 404, so a request never goes without a team.
   */
  async function teamFor(client: AdoClient, connection: AdoConnectionSummary, project: string, team: string | undefined): Promise<Result<string>> {
    if (team !== undefined) return ok(team);
    const key = `${connection.id}\n${client.orgUrl}\n${project.trim().toLowerCase()}`;
    const cached = resolvedTeams.get(key);
    if (cached && cached.expiresAt > now()) return ok(cached.teamId);

    const mine = await listMyTeams(client, project);
    if (!mine.ok) return mine;
    const teamId = mine.data.defaultTeamId ?? mine.data.teams[0]?.id;
    if (teamId === undefined) {
      resolvedTeams.delete(key);
      return err('VALIDATION', `No Azure DevOps team found for you in ${project}. Pick a team from the Team menu.`, {
        org: connection.id,
        project,
        reason: 'no-team',
      });
    }
    resolvedTeams.set(key, { teamId, expiresAt: now() + RESOLVED_TEAM_TTL_MS });
    return ok(teamId);
  }

  /** {@link withClient} for a team-scoped request: `call` gets the request's team or the resolved one. */
  function withTeam<T>(
    request: { org?: string | undefined; project?: string | undefined; team?: string | undefined },
    call: (client: AdoClient, project: string, team: string) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    return withClient(request, async (client, project, connection) => {
      const team = await teamFor(client, connection, project, request.team);
      return team.ok ? call(client, project, team.data) : team;
    });
  }

  const writeBack = createWorkItemWriteBack({ clientFor: (org) => clientFor(org), settings });

  return {
    clientFor,
    writeBack,

    listSprints: (request) => withTeam(request, (client, project, team) => listSprints(client, { project, team })),

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

    activePrs: (request) =>
      withTeam(request, async (client, project, team) => {
        const remotes = (await options.registeredRemotes?.().catch(() => [])) ?? [];
        return listActivePullRequests(client, {
          project,
          team,
          isRegistered: (repository) => isRegisteredRepository(remotes, client.orgUrl, repository),
        });
      }),

    backlog: (request) =>
      withTeam(request, (client, project, team) =>
        getBacklog(client, {
          project,
          team,
          ...(request.filters === undefined ? {} : { filters: request.filters }),
          ...(request.page === undefined ? {} : { page: request.page }),
        }),
      ),

    workItemColors: (request) =>
      withClient(request, (client, project, connection) => {
        const key = `${connection.id}\n${client.orgUrl}\n${project.trim().toLowerCase()}`;
        const cached = colorCache.get(key);
        if (cached && cached.expiresAt > now()) return cached.colors;
        const colors = getWorkItemColors(client, { project }).then((result) => {
          if (!result.ok && colorCache.get(key)?.colors === colors) colorCache.delete(key);
          return result;
        });
        colorCache.set(key, { colors, expiresAt: now() + WORK_ITEM_COLORS_TTL_MS });
        return colors;
      }),

    listTeams: (request) => withClient(request, (client, project) => listMyTeams(client, project)),

    teamBoard: (request) =>
      withTeam(request, (client, project, team) =>
        getTeamBoard(client, { project, team, ...(request.sprint === undefined ? {} : { sprint: request.sprint }) }),
      ),
  };
}

function unavailable(message: string, reason: AdoUnavailableReason, org: string | undefined) {
  return err('ADO_UNAUTHORIZED', message, { reason, ...(org === undefined ? {} : { org }) });
}
