import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFakeAdoOrg, createFakeTeamOrg, FAKE_TEAM_PAT, type FakeAdoOrg, type FakeAdoOrgOptions, type FakeTeamOrg, type FakeWorkItem } from '@agent-lanes/ado-client/testing';

/**
 * The shared fake Azure DevOps organisation (AL-065, `@agent-lanes/ado-client/testing`) served on
 * 127.0.0.1, so the real app's main process can reach it over HTTP with a fixture PAT. Same MSW
 * handlers and data as the unit tests; nothing leaves the machine.
 */
export interface FakeAdoServer {
  /** `http://127.0.0.1:<port>/contoso`: what the test saves as the organisation URL. */
  readonly orgUrl: string;
  /** The fake's state: requests received, work items, pull requests, … */
  readonly org: FakeAdoOrg;
  /** With `teamBoard`: the team board's fake (artboard 08's board, PRs and backlog), answered first. */
  readonly teamOrg: FakeTeamOrg | null;
  /** The PAT both fakes accept. */
  readonly pat: string;
  close(): Promise<void>;
}

export async function startFakeAdoServer(
  options: Omit<FakeAdoOrgOptions, 'orgUrl'> & {
    orgName?: string;
    teamBoard?: boolean;
    /** With `teamBoard`: the team org's work items instead of artboard 08's board (AL-239 adds artboard 11's backlog). */
    teamItems?: FakeWorkItem[];
  } = {},
): Promise<FakeAdoServer> {
  const { orgName = 'contoso', teamBoard = false, teamItems, ...orgOptions } = options;
  // Created once the port is known; requests before that get a 500.
  const ready: { org?: FakeAdoOrg; teamOrg?: FakeTeamOrg } = {};

  const server: Server = createServer((request, response) => {
    void answer(request, response);
  });

  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const { org } = ready;
      if (!org) throw new Error('The fake Azure DevOps organisation is not ready yet.');
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
      }
      const method = request.method ?? 'GET';
      const { port } = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${port}${request.url ?? '/'}`;
      const init = { method, headers, ...(body.length > 0 && method !== 'GET' && method !== 'HEAD' ? { body } : {}) };
      // The team board fake answers what it knows (teams, boards, PRs, backlog); 501 means "not mine".
      const teamReply = ready.teamOrg ? await ready.teamOrg.fetch(url, init) : null;
      const reply = teamReply && teamReply.status !== 501 ? teamReply : await org.fetch(url, init);
      const replyHeaders: Record<string, string> = {};
      reply.headers.forEach((value, name) => {
        replyHeaders[name] = value;
      });
      const replyBody = Buffer.from(await reply.arrayBuffer());
      response.writeHead(reply.status, { ...replyHeaders, 'content-length': String(replyBody.length) });
      response.end(replyBody);
    } catch (cause) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: cause instanceof Error ? cause.message : String(cause) }));
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const orgUrl = `http://127.0.0.1:${port}/${orgName}`;
  const org = createFakeAdoOrg({ ...orgOptions, ...(teamBoard ? { pat: FAKE_TEAM_PAT } : {}), orgUrl });
  ready.org = org;
  ready.teamOrg = teamBoard ? createFakeTeamOrg({ orgUrl, ...(teamItems ? { items: teamItems } : {}) }) : undefined;

  return {
    orgUrl: org.orgUrl,
    org,
    teamOrg: ready.teamOrg ?? null,
    pat: org.pat,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
