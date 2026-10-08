import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { AgentPermissionEventSchema, defaultAgentPermissions, defaultSettings, type RepoCommands } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from '../claude-sdk';
import { createTranscriptService } from '../output/transcript';
import { combineSessionExtras } from '../session-extras';
import { createSessionManager } from '../session-manager';
import { createFakeClaude, fakeInit } from '../testing/fake-claude';
import { fakeClaudeConnections, memoryTickets, recordingEmit, testPermissions } from '../testing/sessions';
import { PERMISSION_CANCELLED_MESSAGE, PERMISSION_DENIED_MESSAGE, createPermissionService, sdkPermissionMode } from './permission-service';

const dotnet: RepoCommands = {
  repoPath: 'C:\\repos\\onsite',
  detected: { toolchain: 'dotnet', manifest: 'OnSite.sln', packageManager: null, build: 'dotnet build OnSite.sln -c Debug', run: null, runTarget: null, runKind: null },
  build: { command: 'dotnet build OnSite.sln -c Debug', origin: 'detected' },
  run: null,
};

function context(signal = new AbortController().signal, extra: Partial<Parameters<CanUseTool>[2]> = {}): Parameters<CanUseTool>[2] {
  return { signal, toolUseID: 'toolu_1', ...extra } as Parameters<CanUseTool>[2];
}

async function startSession(options: { commands?: RepoCommands } = {}) {
  const tickets = await memoryTickets({ id: '71273' });
  const events = recordingEmit();
  const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
  const sessions = createSessionManager({
    claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
    connections: fakeClaudeConnections(),
    tickets,
    emit: events.emit,
    extras: (record) => permissionsExtras(record),
  });
  const transcripts = createTranscriptService({ sessions, tickets, emit: events.emit });
  const permissions = createPermissionService({
    settings: { get: () => defaultSettings() },
    buildCommands: { forRepo: async () => ({ ok: true, data: options.commands ?? dotnet }) },
    emit: events.emit,
    transcripts,
    userName: () => 'Kyle',
    newId: (() => {
      let n = 0;
      return () => `request-${++n}`;
    })(),
  });
  const permissionsExtras = combineSessionExtras([permissions.sessionExtras]);
  await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
  const call = fake.calls[0]!;
  await call.sentCount(1);
  return { call, sessions, permissions, transcripts, events };
}

describe('permission policy for headless sessions (AL-109)', () => {
  it('starts every session in auto mode with the D18 Bash rules and canUseTool, never a prompt it cannot show', async () => {
    const { call, sessions } = await startSession();
    // Auto mode: the classifier allows lower-risk actions; only what it blocks or cannot decide reaches canUseTool.
    expect(call.options.permissionMode).toBe('auto');
    expect(call.options.canUseTool).toBeTypeOf('function');
    expect(call.options).not.toHaveProperty('permissionPromptToolName');
    expect(call.options.allowedTools).toEqual(
      expect.arrayContaining(['Bash(git status:*)', 'Bash(git diff:*)', 'Bash(dotnet build OnSite.sln -c Debug:*)', 'Bash(dotnet test:*)']),
    );
    expect(call.options.allowedTools).not.toContain('Bash(git branch:*)');
    await sessions.dispose();
  });

  it('lets allow-listed Bash commands through canUseTool without asking', async () => {
    const { call, events, sessions } = await startSession();
    const canUseTool = call.options.canUseTool!;
    await expect(canUseTool('Bash', { command: 'git log --oneline -5' }, context())).resolves.toMatchObject({ behavior: 'allow' });
    await expect(canUseTool('Bash', { command: 'dotnet test --no-build' }, context())).resolves.toMatchObject({ behavior: 'allow' });
    expect(events.of('agent:permission')).toEqual([]);
    await sessions.dispose();
  });

  it('asks on the card for anything else, and Deny reaches the agent and the output', async () => {
    const { call, permissions, transcripts, events, sessions } = await startSession();
    // Chained onto an allowed command, so it must still ask.
    const answer = call.options.canUseTool!('Bash', { command: 'git status && rm -rf src' }, context(undefined, { title: 'Claude wants to run a command' }));

    const [waiting] = events.of('agent:permission', '71273');
    expect(AgentPermissionEventSchema.parse({ ...waiting, at: 1 })).toMatchObject({
      state: 'waiting',
      request: { requestId: 'request-1', tool: 'Bash', title: 'Claude wants to run a command', detail: 'git status && rm -rf src' },
    });
    expect(permissions.pending('71273')?.requestId).toBe('request-1');

    expect(permissions.resolve('71273', 'request-1', 'deny')).toBe(true);
    await expect(answer).resolves.toEqual({ behavior: 'deny', message: PERMISSION_DENIED_MESSAGE });
    expect(permissions.pending('71273')).toBeNull();
    expect(events.of('agent:permission', '71273').at(-1)).toMatchObject({ state: 'denied', waiting: null });

    const output = (await transcripts.get('71273')).events.map((event) => event.item);
    expect(output).toContainEqual(expect.objectContaining({ kind: 'system', text: 'Kyle denied Bash · git status && rm -rf src' }));
    expect(permissions.resolve('71273', 'request-1', 'allow-once')).toBe(false);
    await sessions.dispose();
  });

  it('Allow once lets one call through; Allow for this ticket remembers it for the session only', async () => {
    const { call, permissions, transcripts, events, sessions } = await startSession();
    const canUseTool = call.options.canUseTool!;

    const once = canUseTool('WebFetch', { url: 'https://learn.microsoft.com/' }, context());
    permissions.resolve('71273', 'request-1', 'allow-once');
    await expect(once).resolves.toMatchObject({ behavior: 'allow' });

    const again = canUseTool('WebFetch', { url: 'https://example.test/' }, context(undefined, {
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'WebFetch' }], behavior: 'allow', destination: 'localSettings' }],
    }));
    expect(permissions.pending('71273')?.requestId).toBe('request-2');
    permissions.resolve('71273', 'request-2', 'allow-ticket');
    // The CLI is told to remember it for this session, never in a settings file inside the worktree.
    await expect(again).resolves.toEqual({
      behavior: 'allow',
      updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'WebFetch' }], behavior: 'allow', destination: 'session' }],
    });

    await expect(canUseTool('WebFetch', { url: 'https://third.test/' }, context())).resolves.toMatchObject({ behavior: 'allow' });
    expect(events.of('agent:permission', '71273').filter((event) => event['state'] === 'waiting')).toHaveLength(2);

    const lines = (await transcripts.get('71273')).events.flatMap((event) => (event.item.kind === 'system' ? [event.item.text] : []));
    expect(lines).toEqual(['Kyle allowed WebFetch · https://learn.microsoft.com/ once', 'Kyle allowed WebFetch · https://example.test/ for this ticket']);
    await sessions.dispose();
  });

  it('cancels a waiting request when the turn is interrupted or the session ends', async () => {
    const permissions = testPermissions();
    const abort = new AbortController();
    const interrupted = permissions.canUseTool('71273')('mcp__azure-devops__wit_update_work_item', { id: 71273 }, context(abort.signal));
    expect(permissions.pending('71273')?.tool).toBe('azure-devops · wit_update_work_item');
    abort.abort();
    await expect(interrupted).resolves.toEqual({ behavior: 'deny', message: PERMISSION_CANCELLED_MESSAGE });

    const ended = permissions.canUseTool('71273')('WebSearch', { query: 'bUnit' }, context());
    permissions.cancelAll('71273');
    await expect(ended).resolves.toMatchObject({ behavior: 'deny' });
    expect(permissions.pending('71273')).toBeNull();
  });

  it('follows the saved policy: ask for edits, no build commands, extra prefixes', async () => {
    const permissions = createPermissionService({
      settings: { get: () => ({ ...defaultSettings(), agentPermissions: { edits: 'ask', gitRead: false, buildAndTest: false, bashAllow: ['npm run lint'] } }) },
      buildCommands: { forRepo: async () => ({ ok: true, data: dotnet }) },
      emit: recordingEmit().emit,
    });
    const tickets = await memoryTickets({ id: '71273' });
    const extras = await permissions.sessionExtras((await tickets.get('71273'))!);
    expect(extras.permissionMode).toBe('default');
    expect(extras.allowedTools).toEqual(['Bash(npm run lint:*)']);
  });

  it.each([
    ['auto', 'auto'],
    ['accept-edits', 'acceptEdits'],
    ['ask', 'default'],
  ] as const)('runs a session in Settings mode %s as the SDK mode %s', async (mode, sdkMode) => {
    expect(sdkPermissionMode(mode)).toBe(sdkMode);
    const permissions = createPermissionService({
      settings: { get: () => ({ ...defaultSettings(), agentPermissions: { ...defaultAgentPermissions(), mode } }) },
      buildCommands: { forRepo: async () => ({ ok: true, data: dotnet }) },
      emit: recordingEmit().emit,
    });
    const tickets = await memoryTickets({ id: '71273' });
    expect((await permissions.sessionExtras((await tickets.get('71273'))!)).permissionMode).toBe(sdkMode);
  });

  it('switches running sessions to a new mode', async () => {
    const { call, sessions } = await startSession();
    expect(await sessions.setPermissionMode('acceptEdits')).toEqual([]);
    expect(call.permissionModes).toEqual(['acceptEdits']);
    expect(call.log).toContainEqual({ kind: 'setPermissionMode', mode: 'acceptEdits' });
    await sessions.dispose();
  });
});

describe('work item comments: only QA failure reports and answers', () => {
  const COMMENT_TOOL = 'mcp__azure-devops__wit_add_work_item_comment';

  async function gated(stages: Array<'queued' | 'planning' | 'implementing' | 'code-review' | 'qa'>) {
    const tickets = await memoryTickets({ id: '71273' });
    for (const stage of stages) await tickets.update('71273', (record) => ({ ...record, stage }));
    const events = recordingEmit();
    const system: string[] = [];
    const permissions = createPermissionService({
      settings: { get: () => defaultSettings() },
      tickets,
      buildCommands: { forRepo: async () => ({ ok: true, data: dotnet }) },
      emit: events.emit,
      transcripts: { appendSystem: (_ticketId: string, text: string) => void system.push(text) } as never,
    });
    const extras = await permissions.sessionExtras((await tickets.get('71273'))!);
    return { permissions, extras, events, system };
  }

  function hookOf(extras: Awaited<ReturnType<typeof gated>>['extras']) {
    const matcher = extras.hooks?.PreToolUse?.[0];
    if (!matcher) throw new Error('no PreToolUse hook');
    expect(new RegExp(matcher.matcher!).test(COMMENT_TOOL)).toBe(true);
    return (tool: string, input: Record<string, unknown>) =>
      matcher.hooks[0]!({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 'toolu_9' } as never, 'toolu_9', { signal: new AbortController().signal });
  }

  it('denies any other comment in canUseTool with a message the agent reads, without a Needs-you prompt', async () => {
    const { permissions, events, system } = await gated(['planning', 'implementing']);
    const answer = await permissions.canUseTool('71273')(COMMENT_TOOL, { workItemId: 71273, comment: 'Agent Lanes · Implementing — plan approved by Kyle' }, context());
    expect(answer).toMatchObject({ behavior: 'deny', message: expect.stringMatching(/^Agent Lanes only allows work item comments that report or answer a QA failure/) });
    expect(events.of('agent:permission')).toEqual([]);
    expect(permissions.pending('71273')).toBeNull();
    expect(system).toEqual([expect.stringContaining('refused a work item comment')]);
  });

  it('lets a "QA failed" report through in QA, and a "QA fail answer" after QA sent the ticket back', async () => {
    const inQa = await gated(['planning', 'implementing', 'code-review', 'qa']);
    await expect(inQa.permissions.canUseTool('71273')(COMMENT_TOOL, { comment: '## QA failed\n- AC 2: evidence' }, context())).resolves.toMatchObject({ behavior: 'allow' });

    const bounced = await gated(['planning', 'implementing', 'code-review', 'qa', 'implementing']);
    await expect(bounced.permissions.canUseTool('71273')(COMMENT_TOOL, { comment: 'QA fail answer: AC 2 fixed' }, context())).resolves.toMatchObject({ behavior: 'allow' });
    await expect(bounced.permissions.canUseTool('71273')(COMMENT_TOOL, { comment: 'QA failed: again' }, context())).resolves.toMatchObject({ behavior: 'deny' });
    expect(bounced.events.of('agent:permission')).toEqual([]);
  });

  it('enforces the same rule in a PreToolUse hook, so no permission mode or classifier lets a comment past it', async () => {
    const { extras } = await gated(['planning', 'implementing', 'code-review', 'qa']);
    const hook = hookOf(extras);
    await expect(hook(COMMENT_TOOL, { comment: 'Started QA' })).resolves.toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringMatching(/^Agent Lanes only allows/) },
    });
    await expect(hook(COMMENT_TOOL, { comment: 'QA failed\nAC 1: the total is 0.01 out' })).resolves.toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    });
    // A work item update that writes the discussion is a comment too; other MCP calls are left to the mode.
    await expect(
      hook('mcp__azure-devops__wit_update_work_item', { id: 71273, updates: [{ op: 'add', path: '/fields/System.History', value: 'Moved to QA' }] }),
    ).resolves.toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    await expect(hook('mcp__azure-devops__wit_get_work_item', { id: 71273 })).resolves.toEqual({});
  });
});
