import {
  ADO_SCOPES,
  REQUIRED_ADO_SCOPE_ACCESS,
  missingScopesOf,
  ok,
  type AdoScope,
  type AdoScopeAccess,
  type AdoScopeCheck,
  type AdoScopeCheckStatus,
  type Result,
} from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoCallOptions, AdoClient } from './client';
import { adoErr } from './errors';
import { adoPath } from './path';

/**
 * Testing an organisation's PAT (AL-043, design §8): who it signs in as (`_apis/connectionData`),
 * the projects it can see (for the Default project dropdown), and which of the required scopes it
 * has, from one cheap read per area: Work Items (a WIQL query that matches nothing), Code (the
 * first repository) and Build (the first build). A 401 or 403 on a probe marks that area missing;
 * the token itself already passed `connectionData`, so a 401 there means a scope, not a bad token.
 *
 * Write access can't be proven without writing, so it stays `unverified` ("verified on first
 * write"); a later write refused with 403 comes back from the client as `ADO_SCOPE_MISSING`, and
 * {@link adoScopeOfRequest} says which area it was.
 */

/** Connection Data is a preview API in REST 7.1 (Location area). */
export const CONNECTION_DATA_API_VERSION = '7.1-preview.1';

/** Projects per page; the Projects API pages with `$top` and continuation tokens. */
export const PROJECTS_PAGE_SIZE = 100;

/** The identity ADO answers with when it did not accept any credentials. */
const ANONYMOUS_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** A work item query that matches nothing: ids start at 1. */
export const WORK_ITEMS_PROBE_QUERY = 'SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 0';

export type ConnectionCallOptions = Pick<AdoCallOptions, 'signal' | 'timeoutMs'>;

export interface AdoIdentity {
  /** ADO's id for the signed-in user. */
  id: string;
  /** The user's display name ("Kyle Richards"), their own choice first; null when ADO sends none. */
  displayName: string | null;
}

const connectionDataSchema = z.object({
  authenticatedUser: z.object({
    id: z.string().min(1),
    providerDisplayName: z.string().nullish(),
    customDisplayName: z.string().nullish(),
  }),
});

/** `GET {org}/_apis/connectionData`: who the token signs in as. A refused token is `ADO_UNAUTHORIZED`. */
export async function getConnectionIdentity(client: AdoClient, options: ConnectionCallOptions = {}): Promise<Result<AdoIdentity>> {
  const answer = await client.get('/_apis/connectionData', connectionDataSchema, { ...options, apiVersion: CONNECTION_DATA_API_VERSION });
  if (!answer.ok) return answer;
  const user = answer.data.authenticatedUser;
  if (user.id.toLowerCase() === ANONYMOUS_USER_ID) {
    return adoErr('ADO_UNAUTHORIZED', 'Azure DevOps answered as an anonymous user, so it did not accept the personal access token.', {
      kind: 'unauthorized',
      method: 'GET',
    });
  }
  return ok({ id: user.id, displayName: user.customDisplayName?.trim() || user.providerDisplayName?.trim() || null });
}

const projectSchema = z.object({ name: z.string().min(1) });

/** Names of the organisation's projects the token can see, sorted the way a dropdown lists them. */
export async function listProjectNames(client: AdoClient, options: ConnectionCallOptions = {}): Promise<Result<string[]>> {
  const listed = await client.list('/_apis/projects', projectSchema, { ...options, query: { stateFilter: 'wellFormed', $top: PROJECTS_PAGE_SIZE } });
  if (!listed.ok) return listed;
  const names = [...new Set(listed.data.map((project) => project.name))];
  return ok(names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
}

/**
 * Which PAT area and access a request needs, from its method and URL: `/_apis/wit/` and
 * `/_apis/work/` are Work Items, `/_apis/git/` and `/_apis/policy/` are Code, `/_apis/build/` is
 * Build. GET is a read, and so are the two POSTs that only query (WIQL, the work items batch).
 * Undefined for anything the required scopes don't cover (projects, connection data).
 */
export function adoScopeOfRequest(method: string, url: string): { scope: AdoScope; access: AdoScopeAccess } | undefined {
  let path: string;
  try {
    path = new URL(url, 'https://dev.azure.com').pathname.toLowerCase();
  } catch {
    return undefined;
  }
  const area = /\/_apis\/([^/]+)/.exec(path)?.[1];
  const verb = method.toUpperCase();
  const write = verb !== 'GET' && verb !== 'HEAD' && !/\/_apis\/wit\/(?:wiql|workitemsbatch)(?:\/|$)/.test(path);
  switch (area) {
    case 'wit':
    case 'work':
      return { scope: 'work-items', access: write ? 'write' : 'read' };
    case 'git':
      return { scope: 'code', access: write ? 'write' : 'read' };
    case 'policy':
      return write ? undefined : { scope: 'code', access: 'read' };
    case 'build':
      return write ? undefined : { scope: 'build', access: 'read' };
    default:
      return undefined;
  }
}

type Probe = (client: AdoClient, prefix: string, options: ConnectionCallOptions) => Promise<Result<unknown>>;

/** One read per area, each as small as ADO allows. */
const READ_PROBES: Record<AdoScope, Probe> = {
  'work-items': (client, prefix, options) =>
    client.request({
      ...options,
      method: 'POST',
      path: `${prefix}/_apis/wit/wiql`,
      query: { $top: 1 },
      body: { query: WORK_ITEMS_PROBE_QUERY },
      schema: z.unknown(),
    }),
  code: (client, prefix, options) => client.get(`${prefix}/_apis/git/repositories`, z.unknown(), { ...options, query: { $top: 1 } }),
  build: (client, prefix, options) => client.get(`${prefix}/_apis/build/builds`, z.unknown(), { ...options, query: { $top: 1 } }),
};

function probeStatus(result: Result<unknown>): AdoScopeCheckStatus {
  if (result.ok) return 'granted';
  // 401, 403, or a sign-in page instead of data. Anything else (404, 5xx, a timeout) proves nothing.
  return result.code === 'ADO_UNAUTHORIZED' || result.code === 'ADO_SCOPE_MISSING' ? 'missing' : 'unverified';
}

export interface ProbeAdoScopesOptions extends ConnectionCallOptions {
  /**
   * Project to probe in. Builds are listed per project, so without one the Build probe asks at the
   * organisation level and may come back unverified. Null or omitted: organisation level.
   */
  project?: string | null;
}

/**
 * Probes every area at once and returns one check per {@link REQUIRED_ADO_SCOPE_ACCESS} entry.
 * Write access is `missing` when the read already failed (a write scope includes its read scope),
 * otherwise `unverified` until the first write. Never fails: a probe that can't run is `unverified`.
 */
export async function probeAdoScopes(client: AdoClient, options: ProbeAdoScopesOptions = {}): Promise<Result<AdoScopeCheck[]>> {
  const { project, ...call } = options;
  const prefix = project ? adoPath`/${project}` : '';
  const reads = new Map(
    await Promise.all(ADO_SCOPES.map(async (scope) => [scope, probeStatus(await READ_PROBES[scope](client, prefix, call))] as const)),
  );
  return ok(
    REQUIRED_ADO_SCOPE_ACCESS.map(({ scope, access }): AdoScopeCheck => {
      const read = reads.get(scope) ?? 'unverified';
      if (access === 'read') return { scope, access, status: read };
      return { scope, access, status: read === 'missing' ? 'missing' : 'unverified' };
    }),
  );
}

export interface AdoConnectionTestOptions extends ConnectionCallOptions {
  /** The project the user picked, probed first when the token can see it. */
  defaultProject?: string | null;
}

export interface AdoConnectionTest {
  identity: AdoIdentity;
  /** For the Default project dropdown; null when the token may not list projects or the list failed. */
  projects: string[] | null;
  /** One check per required area and access. */
  scopes: AdoScopeCheck[];
  /** Areas with any access missing. */
  missingScopes: AdoScope[];
}

/** The project the probes run in: the default project if the token can see it, else the first one listed. */
function probeProject(projects: string[] | null, preferred: string | null): string | null {
  if (projects === null) return preferred;
  const wanted = preferred?.toLowerCase();
  return projects.find((name) => name.toLowerCase() === wanted) ?? projects[0] ?? null;
}

/**
 * The whole test: identity first (a refused token fails the test with the client's error), then the
 * project list, then the scope probes in one of those projects. Missing scopes don't fail the test.
 */
export async function testAdoConnection(client: AdoClient, options: AdoConnectionTestOptions = {}): Promise<Result<AdoConnectionTest>> {
  const { defaultProject = null, ...call } = options;
  const identity = await getConnectionIdentity(client, call);
  if (!identity.ok) return identity;

  const listed = await listProjectNames(client, call);
  const projects = listed.ok ? listed.data : null;
  const scopes = await probeAdoScopes(client, { ...call, project: probeProject(projects, defaultProject) });
  if (!scopes.ok) return scopes;
  return ok({ identity: identity.data, projects, scopes: scopes.data, missingScopes: missingScopesOf(scopes.data) });
}
