import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpConnectionTester } from './mcp-tester';
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from './testing';
import type { DraftOf } from './testers';

/** Made up for these tests; shaped like a real token, valid nowhere. */
const TOKEN = 'ghp_fakeTester000000000000000000000Mcp1';

const FAKE_SERVER = fileURLToPath(new URL('./testing/fake-mcp-server.mjs', import.meta.url));

function stdio(args: string[], extra: Partial<Extract<DraftOf<'mcp'>['transport'], { type: 'stdio' }>> = {}, token?: string): DraftOf<'mcp'> {
  return {
    kind: 'mcp',
    name: 'Fake',
    transport: { type: 'stdio', command: process.execPath, args, envVar: null, ...extra },
    ...(token ? { token } : {}),
  };
}

function remote(type: 'http' | 'sse', url: string, header: string | null, token?: string): DraftOf<'mcp'> {
  return { kind: 'mcp', name: 'Remote', transport: { type, url, header }, ...(token ? { token } : {}) };
}

const signal = () => AbortSignal.timeout(30_000);

let http: FakeMcpHttpServer | undefined;

afterEach(async () => {
  await http?.close();
  http = undefined;
});

describe('MCP connection test (stdio)', () => {
  const test = createMcpConnectionTester({ timeoutMs: 15_000 });

  it('starts the server, does the handshake and lists its tools', async () => {
    const outcome = await test(stdio([FAKE_SERVER]), signal());
    expect(outcome).toEqual({ status: 'ok', identity: 'fake-mcp 1.2.3', message: null, tools: ['echo'] });
  });

  it('follows the tool list across pages', async () => {
    const outcome = await test(stdio([FAKE_SERVER, '--tools', '7']), signal());
    expect(outcome.tools).toEqual(['tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5', 'tool-6', 'tool-7']);
  });

  it('gives the server its token in the env var the user named, and nothing in its args', async () => {
    const outcome = await test(stdio([FAKE_SERVER, '--report-env', 'FAKE_MCP_TOKEN'], { envVar: 'FAKE_MCP_TOKEN' }, TOKEN), signal());
    const digest = createHash('sha256').update(TOKEN).digest('hex').slice(0, 12);
    expect(outcome.status).toBe('ok');
    expect(outcome.tools).toContain(`env-FAKE_MCP_TOKEN-${digest}`);
  });

  it("doesn't pass the app's own environment on to the server", async () => {
    process.env['AGENT_LANES_TEST_LEAK'] = 'should-not-reach-the-server';
    try {
      const outcome = await test(stdio([FAKE_SERVER, '--report-env', 'AGENT_LANES_TEST_LEAK']), signal());
      expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining('AGENT_LANES_TEST_LEAK is not set') });
    } finally {
      delete process.env['AGENT_LANES_TEST_LEAK'];
    }
  });

  it('reports the error output of a server that exits before answering', async () => {
    const outcome = await test(stdio([FAKE_SERVER, '--fail', 'Error: config file C:/nowhere/mcp.json not found', '--exit', '3']), signal());
    expect(outcome.status).toBe('error');
    expect(outcome.identity).toBeNull();
    expect(outcome.tools).toBeUndefined();
    const [headline, ...output] = (outcome.message ?? '').split('\n');
    expect(headline).toMatch(/stopped before it answered as an MCP server/);
    expect(output.join('\n')).toBe('Error: config file C:/nowhere/mcp.json not found');
  });

  it('keeps only the end of a long error output', async () => {
    const long = `${'x'.repeat(5000)} the actual error at the end`;
    const outcome = await test(stdio(['-e', `process.stderr.write(${JSON.stringify(long)}); process.exit(1)`]), signal());
    expect(outcome.message).toMatch(/…x+ the actual error at the end$/);
    expect((outcome.message ?? '').length).toBeLessThan(2_200);
  });

  it('says when the command does not exist', async () => {
    const outcome = await test(stdio([], { command: 'agent-lanes-no-such-command-4f2a' }), signal());
    expect(outcome.status).toBe('error');
    // Not found by the OS (ENOENT), or by cmd.exe when cross-spawn goes through it on Windows.
    expect(outcome.message).toMatch(/^Could not start "agent-lanes-no-such-command-4f2a": the command was not found/);
  });

  it('gives up on a server that never answers', async () => {
    const quick = createMcpConnectionTester({ timeoutMs: 1_500 });
    const outcome = await quick(stdio([FAKE_SERVER, '--silent']), signal());
    expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining('did not answer within 2 seconds') });
  });

  it('skips a log line a server writes to stdout', async () => {
    expect(await test(stdio([FAKE_SERVER, '--noise']), signal())).toMatchObject({ status: 'ok', tools: ['echo'] });
  });

  it("says so when the command isn't an MCP server", async () => {
    // Long enough for node to start and print under a loaded full run; 1.5 s was not.
    const quick = createMcpConnectionTester({ timeoutMs: 3_000 });
    const outcome = await quick(stdio(['-e', "console.log('hello there'); setTimeout(() => {}, 60000)"]), signal());
    expect(outcome.status).toBe('error');
    expect(outcome.message).toMatch(/did not answer within 3 seconds\.\nIts output isn't MCP: /);
  }, 15_000);

  it('stops when the service gives up', async () => {
    const controller = new AbortController();
    const pending = test(stdio([FAKE_SERVER, '--silent']), controller.signal);
    setTimeout(() => controller.abort(), 300);
    expect(await pending).toMatchObject({ status: 'error', message: expect.stringContaining('did not answer') });
  });

  describe('when done', () => {
    const killed: number[] = [];
    const tracked = createMcpConnectionTester({
      timeoutMs: 15_000,
      killTree: async (pid) => {
        killed.push(pid);
        process.kill(pid);
      },
    });

    afterEach(() => {
      killed.length = 0;
    });

    it('lets a server stop by closing its stdin', async () => {
      expect((await tracked(stdio([FAKE_SERVER]), signal())).status).toBe('ok');
      expect(killed).toEqual([]);
    });

    it('ends a server that keeps running, with its whole process tree', async () => {
      expect((await tracked(stdio([FAKE_SERVER, '--linger']), signal())).status).toBe('ok');
      expect(killed).toHaveLength(1);
      expect(() => process.kill(killed[0] ?? 0, 0)).toThrow();
    });
  });
});

describe('MCP connection test (HTTP and SSE)', () => {
  const test = createMcpConnectionTester({ timeoutMs: 10_000 });

  it('connects over streamable HTTP with the token as a Bearer Authorization header', async () => {
    http = await startFakeMcpHttpServer({ requireHeader: { name: 'Authorization', value: `Bearer ${TOKEN}` } });
    const outcome = await test(remote('http', `${http.origin}/mcp`, 'Authorization', TOKEN), signal());
    expect(outcome).toEqual({ status: 'ok', identity: 'fake-mcp-http 2.0.0', message: null, tools: ['search', 'fetch'] });
    expect(http.requests.filter((request) => request.method === 'POST').every((request) => request.authorized)).toBe(true);
  });

  it('puts the token in any other header as it is', async () => {
    http = await startFakeMcpHttpServer({ requireHeader: { name: 'X-API-Key', value: TOKEN } });
    expect(await test(remote('http', `${http.origin}/mcp`, 'X-API-Key', TOKEN), signal())).toMatchObject({ status: 'ok' });
  });

  it('connects over SSE', async () => {
    http = await startFakeMcpHttpServer({ requireHeader: { name: 'X-API-Key', value: TOKEN }, tools: ['lookup'] });
    const outcome = await test(remote('sse', `${http.origin}/sse`, 'X-API-Key', TOKEN), signal());
    expect(outcome).toEqual({ status: 'ok', identity: 'fake-mcp-http 2.0.0', message: null, tools: ['lookup'] });
    expect(http.requests.some((request) => request.path === '/sse' && request.authorized)).toBe(true);
  });

  it('says the server refused the token', async () => {
    http = await startFakeMcpHttpServer({ requireHeader: { name: 'Authorization', value: `Bearer ${TOKEN}` } });
    const outcome = await test(remote('http', `${http.origin}/mcp`, 'Authorization', 'ghp_wrong000000000000000000000000000000x'), signal());
    expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining('refused the request (HTTP 401)') });
  });

  it('says when nothing is listening', async () => {
    http = await startFakeMcpHttpServer();
    const url = `${http.origin}/mcp`;
    await http.close();
    http = undefined;
    const outcome = await test(remote('http', url, null), signal());
    expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining(`Could not connect to ${url}`) });
  });
});
