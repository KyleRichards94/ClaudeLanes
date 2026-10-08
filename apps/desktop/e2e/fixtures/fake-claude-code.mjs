// A stand-in for the `claude` binary the Agent SDK starts (AL-044 e2e). It speaks the SDK's
// stream-json protocol on stdin/stdout and never contacts anything: no login is read, no request
// leaves the machine. What it does is set by a JSON file named in AGENT_LANES_FAKE_CLAUDE_STATE:
//
//   { "login": { "email", "organization", "subscriptionType" } | null,
//     "apiKeys": ["keys this fake accepts"],
//     "log": "path of a JSON-lines file to record each start in",
//     "design": { "artboards": [{ id, name, width, height }], "reply"?: "text, {prompt} = the message" }
//       (AL-195: Claude Design access and what a design session answers; AL-196: the design thread's reply),
//     "commands": [{ name, description, argumentHint, builtin? }] (AL-114: what supportedCommands() lists),
//     "lead": { "turns": [{ "match"?: "text in the prompt", "steps": [step, …] }] } }
//       (AL-222: a scripted ticket agent, see below)
//
// `lead` scripts the sessions that have the app's in-process `agent_lanes` MCP server (ticket
// sessions; design and connection-test sessions don't). Each user turn takes the first unused turn
// whose `match` is in the prompt (a turn without `match` takes any prompt) and runs its steps in order:
//
//   { "tool": "set_stage", "input": { "stage": "implementing", "summary": "…" } }
//       calls that tool of the agent_lanes server through the SDK, as the real CLI's MCP client does,
//       and waits for its result (a gated `set_stage` waits for the user's decision);
//   { "commit": { "file": "relative path", "content": "…", "message": "…" } }
//       writes the file in the session's working directory (the worktree) and commits it;
//   { "text": "…" }  what the agent says at the end of the turn ("OK" when no step says anything).
//
// Tool calls and commits show in the transcript as tool_use / tool_result messages.
//
// The log says whether an API key arrived and whether it was accepted, never the key itself.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const state = JSON.parse(readFileSync(process.env.AGENT_LANES_FAKE_CLAUDE_STATE ?? '', 'utf8'));
const apiKey = process.env.ANTHROPIC_API_KEY;
const keyAccepted = apiKey !== undefined && (state.apiKeys ?? []).includes(apiKey);
// The SDK resumes a session with `--resume=<id>`; the resumed session keeps its id, as the real CLI's does.
const sessionId = process.argv.find((arg) => arg.startsWith('--resume='))?.slice('--resume='.length) ?? randomUUID();
const record = {
  argv: process.argv.slice(2),
  apiKey: apiKey === undefined ? null : keyAccepted ? 'accepted' : 'refused',
  prompts: [],
  // Which worktree and process this was (AL-100's session tests).
  cwd: process.cwd(),
  pid: process.pid,
  // AL-222: what each scripted tool call answered.
  tools: [],
};

/** The SDK MCP servers the host runs in-process, from its `initialize` request. */
let sdkMcpServers = [];
const usedTurns = new Set();

function writeLog() {
  if (state.log) appendFileSync(state.log, `${JSON.stringify(record)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** What `accountInfo()` reads: the credential an API request would use. */
function account() {
  if (apiKey !== undefined) return { apiKeySource: 'ANTHROPIC_API_KEY', tokenSource: 'none', apiProvider: 'firstParty' };
  if (state.login) return { ...state.login, tokenSource: 'claude.ai', apiKeySource: 'none', apiProvider: 'firstParty' };
  return { tokenSource: 'none', apiKeySource: 'none', apiProvider: 'firstParty' };
}

// Control requests this fake sends to the SDK (calls to its in-process MCP servers), by request id.
const pendingControl = new Map();

function controlRequest(request) {
  const requestId = `fake_${randomUUID()}`;
  return new Promise((resolve, reject) => {
    pendingControl.set(requestId, { resolve, reject });
    send({ type: 'control_request', request_id: requestId, request });
  });
}

let mcpId = 0;
const initialisedServers = new Set();

/** A JSON-RPC request to one of the SDK's in-process MCP servers, sent the way the CLI's MCP client sends it. */
async function mcpRequest(server, method, params) {
  const id = ++mcpId;
  const response = await controlRequest({ subtype: 'mcp_message', server_name: server, message: { jsonrpc: '2.0', id, method, params } });
  const reply = response?.mcp_response;
  if (reply?.error) throw new Error(`${server} ${method}: ${reply.error.message ?? JSON.stringify(reply.error)}`);
  return reply?.result;
}

async function callServerTool(server, name, input) {
  if (!initialisedServers.has(server)) {
    await mcpRequest(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude-code', version: '0.0.0' } });
    await controlRequest({ subtype: 'mcp_message', server_name: server, message: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    initialisedServers.add(server);
  }
  const result = await mcpRequest(server, 'tools/call', { name, arguments: input ?? {} });
  const text = (result?.content ?? []).map((block) => block.text ?? '').join('');
  return { text, isError: result?.isError === true };
}

function assistant(content, model, usage, extra = {}) {
  send({
    type: 'assistant',
    message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model, content, stop_reason: 'end_turn', stop_sequence: null, usage },
    parent_tool_use_id: null,
    ...extra,
    uuid: randomUUID(),
    session_id: sessionId,
  });
}

function toolResult(toolUseId, text, isError) {
  send({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }], ...(isError ? { is_error: true } : {}) }] },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
  });
}

/** The scripted turn for this prompt, when this is a ticket session and the state has a `lead` script. */
function scriptedTurn(prompt) {
  if (!state.lead || !sdkMcpServers.includes('agent_lanes')) return null;
  const turns = state.lead.turns ?? [];
  const index = turns.findIndex((turn, at) => !usedTurns.has(at) && (turn.match === undefined || prompt.includes(turn.match)));
  if (index === -1) return null;
  usedTurns.add(index);
  return turns[index];
}

function git(...args) {
  return execFileSync('git', ['-c', 'user.name=Fake Claude', '-c', 'user.email=fake-claude@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Runs a scripted turn's steps; returns what the agent says at the end, if a step says it. */
async function runSteps(steps, model, usage) {
  let said = null;
  for (const step of steps) {
    if (step.tool) {
      const toolUseId = `toolu_${randomUUID()}`;
      assistant([{ type: 'tool_use', id: toolUseId, name: `mcp__agent_lanes__${step.tool}`, input: step.input ?? {} }], model, usage);
      const { text, isError } = await callServerTool('agent_lanes', step.tool, step.input);
      record.tools.push({ tool: step.tool, text, isError });
      toolResult(toolUseId, text, isError);
    } else if (step.commit) {
      const { file, content, message } = step.commit;
      const toolUseId = `toolu_${randomUUID()}`;
      assistant([{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command: `git commit -m "${message}"`, description: 'Commit the change' } }], model, usage);
      const path = join(process.cwd(), file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      git('add', '--', file);
      git('commit', '--quiet', '-m', message);
      toolResult(toolUseId, `[${git('rev-parse', '--abbrev-ref', 'HEAD').trim()}] ${message}`, false);
    } else if (step.text !== undefined) {
      said = step.text;
    }
  }
  return said;
}

async function answer(prompt) {
  record.prompts.push(prompt);
  const model = flag('--model') ?? 'claude-haiku-4-5';
  const authenticated = apiKey !== undefined ? keyAccepted : Boolean(state.login);
  send({
    type: 'system',
    subtype: 'init',
    apiKeySource: apiKey !== undefined ? 'ANTHROPIC_API_KEY' : 'none',
    claude_code_version: '0.0.0-fake',
    cwd: process.cwd(),
    // AL-195: a login with Claude Design access offers its tools; the design session gets the artboard list.
    tools: state.design ? ['ClaudeDesign', 'Artifact'] : [],
    mcp_servers: [],
    model,
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: randomUUID(),
    session_id: sessionId,
  });
  const usage = { input_tokens: authenticated ? 12 : 0, output_tokens: authenticated ? 1 : 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const turn = authenticated ? scriptedTurn(prompt) : null;
  const scripted = turn ? await runSteps(turn.steps ?? [], model, usage) : null;
  const designReply = state.design?.reply?.replaceAll('{prompt}', prompt);
  const text = authenticated ? (scripted ?? designReply ?? 'OK') : apiKey !== undefined ? 'Invalid API key · Fix external API key' : 'Not logged in · Please run /login';
  assistant([{ type: 'text', text }], authenticated ? model : '<synthetic>', usage, authenticated ? {} : { error: 'authentication_failed' });
  send({
    type: 'result',
    subtype: 'success',
    is_error: !authenticated,
    ...(authenticated ? {} : { api_error_status: 401 }),
    duration_ms: 5,
    duration_api_ms: 4,
    num_turns: 1,
    result: text,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage,
    modelUsage: {},
    ...(state.design && authenticated ? { structured_output: { artboards: state.design.artboards } } : {}),
    permission_denials: [],
    uuid: randomUUID(),
    session_id: sessionId,
  });
}

// User turns run one at a time, as the CLI's do: a message that arrives mid-turn waits for the turn to end.
let turns = Promise.resolve();

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    if (message.request?.subtype === 'initialize') sdkMcpServers = message.request.sdkMcpServers ?? [];
    const response =
      message.request?.subtype === 'initialize'
        ? { commands: state.commands ?? [], agents: [], output_style: 'default', available_output_styles: ['default'], models: [], account: account() }
        : {};
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
  } else if (message.type === 'control_response') {
    const pending = pendingControl.get(message.response?.request_id);
    if (!pending) return;
    pendingControl.delete(message.response.request_id);
    if (message.response.subtype === 'success') pending.resolve(message.response.response);
    else pending.reject(new Error(message.response.error ?? 'The control request failed.'));
  } else if (message.type === 'user') {
    const content = message.message?.content;
    const prompt = typeof content === 'string' ? content : (content ?? []).map((block) => block.text ?? '').join('');
    turns = turns
      .then(() => answer(prompt))
      .catch((cause) => process.stderr.write(`fake-claude-code: ${cause instanceof Error ? cause.message : String(cause)}\n`));
  }
});
lines.on('close', () => {
  writeLog();
  process.exit(0);
});
