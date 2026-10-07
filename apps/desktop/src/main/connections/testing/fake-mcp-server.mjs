// A minimal MCP server over stdio, for tests of the MCP connection test (AL-045). Newline-delimited
// JSON-RPC: answers initialize, ping and tools/list; no dependencies, so `node <this file>` runs it.
//
//   --fail <text> [--exit <code>]  write <text> to stderr and exit before answering (default code 1)
//   --report-env <NAME>           exit with an error if env NAME is missing; otherwise list a tool
//                                 `env-<NAME>-<first 12 hex of sha256(value)>`, so a test can check the
//                                 value without the value appearing anywhere
//   --silent                      read requests and never answer
//   --noise                       write a line that isn't JSON-RPC to stdout first
//   --tools <n>                   list n tools (`tool-1` …), 3 per page, to exercise paging
//   --linger                      keep running after stdin closes (a server that ignores the request to stop)
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const failure = option('--fail');
if (failure !== undefined) {
  process.stderr.write(`${failure}\n`);
  process.exit(Number(option('--exit') ?? 1));
}

const reportEnv = option('--report-env');
if (reportEnv !== undefined && !process.env[reportEnv]) {
  process.stderr.write(`fake-mcp: ${reportEnv} is not set\n`);
  process.exit(2);
}

if (flag('--noise')) process.stdout.write('fake-mcp starting up (not JSON-RPC)\n');

const count = Number(option('--tools') ?? 0);
const tools = count > 0 ? Array.from({ length: count }, (_, index) => `tool-${index + 1}`) : ['echo'];
if (reportEnv !== undefined) {
  tools.push(`env-${reportEnv}-${createHash('sha256').update(process.env[reportEnv] ?? '').digest('hex').slice(0, 12)}`);
}
const PAGE = count > 0 ? 3 : tools.length;

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function answer(request) {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp', version: '1.2.3' },
      };
    case 'ping':
      return {};
    case 'tools/list': {
      const start = Number(request.params?.cursor ?? 0);
      const page = tools.slice(start, start + PAGE).map((name) => ({ name, description: `Fake ${name}`, inputSchema: { type: 'object', properties: {} } }));
      const next = start + PAGE;
      return next < tools.length ? { tools: page, nextCursor: String(next) } : { tools: page };
    }
    default:
      return undefined;
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (flag('--silent') || line.trim() === '') return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return; // a notification
  const result = answer(request);
  if (result === undefined) send({ id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } });
  else send({ id: request.id, result });
});
lines.on('close', () => {
  if (flag('--linger')) setInterval(() => undefined, 60_000);
  else process.exit(0);
});
