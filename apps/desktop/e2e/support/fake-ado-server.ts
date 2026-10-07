import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createFakeAdoOrg, type FakeAdoOrg, type FakeAdoOrgOptions } from '@agent-lanes/ado-client/testing';

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
  close(): Promise<void>;
}

export async function startFakeAdoServer(options: Omit<FakeAdoOrgOptions, 'orgUrl'> & { orgName?: string } = {}): Promise<FakeAdoServer> {
  const { orgName = 'contoso', ...orgOptions } = options;
  // Created once the port is known; requests before that get a 500.
  const ready: { org?: FakeAdoOrg } = {};

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
      const reply = await org.fetch(`http://127.0.0.1:${port}${request.url ?? '/'}`, {
        method,
        headers,
        ...(body.length > 0 && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
      });
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
  const org = createFakeAdoOrg({ ...orgOptions, orgUrl: `http://127.0.0.1:${port}/${orgName}` });
  ready.org = org;

  return {
    orgUrl: org.orgUrl,
    org,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
