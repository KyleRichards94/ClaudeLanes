// A stand-in for the `claude` binary the Agent SDK starts (AL-044 e2e). It speaks the SDK's
// stream-json protocol on stdin/stdout and never contacts anything: no login is read, no request
// leaves the machine. What it does is set by a JSON file named in AGENT_LANES_FAKE_CLAUDE_STATE:
//
//   { "login": { "email", "organization", "subscriptionType" } | null,
//     "apiKeys": ["keys this fake accepts"],
//     "log": "path of a JSON-lines file to record each start in",
//     "design": { "artboards": [{ id, name, width, height }], "reply"?: "text, {prompt} = the message" }
//       (AL-195: Claude Design access and what a design session answers; AL-196: the design thread's reply) }
//
// The log says whether an API key arrived and whether it was accepted, never the key itself.
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const state = JSON.parse(readFileSync(process.env.AGENT_LANES_FAKE_CLAUDE_STATE ?? '', 'utf8'));
const apiKey = process.env.ANTHROPIC_API_KEY;
const keyAccepted = apiKey !== undefined && (state.apiKeys ?? []).includes(apiKey);
// The SDK resumes a session with `--resume=<id>`; the resumed session keeps its id, as the real CLI's does.
const sessionId = process.argv.find((arg) => arg.startsWith('--resume='))?.slice('--resume='.length) ?? randomUUID();
const record = { argv: process.argv.slice(2), apiKey: apiKey === undefined ? null : keyAccepted ? 'accepted' : 'refused', prompts: [] };

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

function answer(prompt) {
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
  const designReply = state.design?.reply?.replaceAll('{prompt}', prompt);
  const text = authenticated ? (designReply ?? 'OK') : apiKey !== undefined ? 'Invalid API key · Fix external API key' : 'Not logged in · Please run /login';
  const usage = { input_tokens: authenticated ? 12 : 0, output_tokens: authenticated ? 1 : 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  send({
    type: 'assistant',
    message: {
      id: `msg_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: authenticated ? model : '<synthetic>',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage,
    },
    parent_tool_use_id: null,
    ...(authenticated ? {} : { error: 'authentication_failed' }),
    uuid: randomUUID(),
    session_id: sessionId,
  });
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

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    const response =
      message.request?.subtype === 'initialize'
        ? { commands: [], agents: [], output_style: 'default', available_output_styles: ['default'], models: [], account: account() }
        : {};
    send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
  } else if (message.type === 'user') {
    const content = message.message?.content;
    answer(typeof content === 'string' ? content : (content ?? []).map((block) => block.text ?? '').join(''));
  }
});
lines.on('close', () => {
  writeLog();
  process.exit(0);
});
