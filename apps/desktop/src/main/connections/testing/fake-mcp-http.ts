import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A fake MCP server on 127.0.0.1 for tests of the MCP connection test (AL-045): streamable HTTP at
 * `/mcp` (JSON responses) and the older SSE transport at `/sse` + `/messages`. It answers initialize,
 * ping and tools/list, and can require a header, so tests can check the token reaches it. Nothing
 * here talks to a real server. No `import.meta`, so Playwright specs can import it too.
 */
export interface FakeMcpHttpServer {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  /** Each request: method, path and whether the required header (if any) matched. */
  readonly requests: Array<{ method: string; path: string; authorized: boolean }>;
  close(): Promise<void>;
}

export interface FakeMcpHttpServerOptions {
  /** When set, requests without this header and value get 401. */
  requireHeader?: { name: string; value: string };
  tools?: string[];
}

interface JsonRpcRequest {
  id?: number | string;
  method: string;
  params?: { protocolVersion?: string };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

export function startFakeMcpHttpServer(options: FakeMcpHttpServerOptions = {}): Promise<FakeMcpHttpServer> {
  const tools = options.tools ?? ['search', 'fetch'];
  const requests: FakeMcpHttpServer['requests'] = [];
  const streams = new Map<string, ServerResponse>();
  let sessions = 0;

  function answer(message: JsonRpcRequest): unknown {
    switch (message.method) {
      case 'initialize':
        return {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-mcp-http', version: '2.0.0' },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: tools.map((name) => ({ name, inputSchema: { type: 'object', properties: {} } })) };
      default:
        return undefined;
    }
  }

  function reply(message: JsonRpcRequest): unknown {
    const result = answer(message);
    return result === undefined
      ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
      : { jsonrpc: '2.0', id: message.id, result };
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const required = options.requireHeader;
      const authorized = !required || request.headers[required.name.toLowerCase()] === required.value;
      requests.push({ method: request.method ?? '', path: url.pathname, authorized });
      if (!authorized) {
        response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
        return;
      }

      if (url.pathname === '/mcp') {
        if (request.method !== 'POST') {
          response.writeHead(405).end();
          return;
        }
        const message = JSON.parse(await readBody(request)) as JsonRpcRequest;
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply(message)));
        return;
      }

      if (url.pathname === '/sse' && request.method === 'GET') {
        const session = String((sessions += 1));
        streams.set(session, response);
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        response.write(`event: endpoint\ndata: /messages?session=${session}\n\n`);
        request.on('close', () => streams.delete(session));
        return;
      }

      if (url.pathname === '/messages' && request.method === 'POST') {
        const stream = streams.get(url.searchParams.get('session') ?? '');
        const message = JSON.parse(await readBody(request)) as JsonRpcRequest;
        response.writeHead(202).end('Accepted');
        if (stream && message.id !== undefined) stream.write(`event: message\ndata: ${JSON.stringify(reply(message))}\n\n`);
        return;
      }

      response.writeHead(404).end();
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({
        origin,
        requests,
        close: () =>
          new Promise<void>((done) => {
            for (const stream of streams.values()) stream.end();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
