import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { join } from 'node:path';
import { AgentPermissionEventSchema, defaultAgentPermissions, defaultSettings, ok, type RepoCommands, type Settings, type SettingsPatch } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from '../claude-sdk';
import { createTranscriptService } from '../output/transcript';
import { combineSessionExtras } from '../session-extras';
import { createSessionManager } from '../session-manager';
import { createFakeClaude, fakeInit } from '../testing/fake-claude';
import { newTicketInput } from '../../tickets/testing';
import { SESSION_TEST_BASE, fakeClaudeConnections, memoryTickets, recordingEmit, testPermissions } from '../testing/sessions';
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

/** Settings whose repo is the test ticket's, with `update` recording what "Always allow" saves (AL-260). */
function savingSettings() {
  let saved: Settings = {
    ...defaultSettings(),
    repos: [{ path: join(SESSION_TEST_BASE, 'onsite-companion'), name: 'onsite-companion', baseBranch: 'main', worktreeRoot: join(SESSION_TEST_BASE, '.agent-lanes'), buildCommand: null, runCommand: null, maxConcurrentAgents: 3 }],
  };
  return {
    get: () => saved,
    update: (patch: SettingsPatch) => {
      saved = { ...saved, ...(patch.repos ? { repos: patch.repos } : {}) };
      return ok(saved);
    },
  };
}

async function startSession(options: { commands?: RepoCommands; settings?: ReturnType<typeof savingSettings> } = {}) {
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
    settings: options.settings ?? { get: () => defaultSettings() },
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

describe('permission prompts at the waiting row (AL-260)', () => {
  it('names the tool use, carries the whole input and a suggested rule, and sends a deny reason to the agent', async () => {
    const { call, permissions, transcripts, events, sessions } = await startSession();
    const answer = call.options.canUseTool!('Bash', { command: 'dotnet publish OnSite.sln -c Release' }, context(undefined, { toolUseID: 'toolu_publish' }));

    const [waiting] = events.of('agent:permission', '71273');
    expect(AgentPermissionEventSchema.parse({ ...waiting, at: 1 }).request).toMatchObject({
      toolUseId: 'toolu_publish',
      input: 'dotnet publish OnSite.sln -c Release',
      suggestedRule: 'Bash(dotnet publish:*)',
    });

    expect(permissions.resolve('71273', 'request-1', 'deny', { reason: 'Use the cached build output' })).toBe(true);
    await expect(answer).resolves.toEqual({ behavior: 'deny', message: `${PERMISSION_DENIED_MESSAGE} The user said: Use the cached build output` });
    const output = (await transcripts.get('71273')).events.map((event) => event.item);
    expect(output).toContainEqual(expect.objectContaining({ kind: 'system', text: 'Kyle denied Bash · dotnet publish OnSite.sln -c Release · Use the cached build output' }));
    await sessions.dispose();
  });

  it("Always allow saves the rule on the ticket's repo; calls it covers skip the prompt, others still ask", async () => {
    const settings = savingSettings();
    const { call, permissions, transcripts, events, sessions } = await startSession({ settings });
    const canUseTool = call.options.canUseTool!;

    const first = canUseTool('Bash', { command: 'dotnet publish OnSite.sln' }, context(undefined, { toolUseID: 'toolu_1' }));
    const second = canUseTool('Bash', { command: 'dotnet publish OnSite.sln -c Release' }, context(undefined, { toolUseID: 'toolu_2' }));
    expect(events.of('agent:permission', '71273').filter((event) => event['state'] === 'waiting')).toHaveLength(2);
    expect(permissions.pending('71273')?.suggestedRule).toBe('Bash(dotnet publish:*)');

    // The suggested rule is saved, and the second waiting call it covers goes through with the first.
    expect(permissions.resolve('71273', 'request-1', 'allow-pattern')).toBe(true);
    await expect(first).resolves.toMatchObject({ behavior: 'allow' });
    await expect(second).resolves.toMatchObject({ behavior: 'allow' });
    expect(settings.get().repos[0]?.permissionRules).toEqual(['Bash(dotnet publish:*)']);
    expect(permissions.pending('71273')).toBeNull();

    // From now on the rule answers without a prompt; a command it does not cover still asks.
    await expect(canUseTool('Bash', { command: 'dotnet publish Other.sln' }, context())).resolves.toMatchObject({ behavior: 'allow' });
    const other = canUseTool('Bash', { command: 'dotnet nuget push x.nupkg' }, context());
    expect(permissions.pending('71273')?.requestId).toBe('request-3');
    // A rule the user typed is saved as given; an unsafe one is not saved but the call is still allowed.
    expect(permissions.resolve('71273', 'request-3', 'allow-pattern', { rule: 'Bash(dotnet nuget:*)' })).toBe(true);
    await expect(other).resolves.toMatchObject({ behavior: 'allow' });
    expect(settings.get().repos[0]?.permissionRules).toEqual(['Bash(dotnet publish:*)', 'Bash(dotnet nuget:*)']);
    const unsafe = canUseTool('Bash', { command: 'rm -rf build && dotnet publish' }, context());
    expect(permissions.pending('71273')?.suggestedRule).toBeNull();
    permissions.resolve('71273', 'request-4', 'allow-pattern');
    await expect(unsafe).resolves.toMatchObject({ behavior: 'allow' });
    expect(settings.get().repos[0]?.permissionRules).toHaveLength(2);

    const lines = (await transcripts.get('71273')).events.flatMap((event) => (event.item.kind === 'system' ? [event.item.text] : []));
    expect(lines).toContain('Kyle allowed Bash · dotnet publish OnSite.sln always (Bash(dotnet publish:*))');
    expect(lines).toContain("Allowed Bash by the repo's rule");
    expect(lines).toContain('Kyle allowed Bash · rm -rf build && dotnet publish always (no rule saved)');
    await sessions.dispose();
  });
});

describe("the ticket's own permission mode (AL-264)", () => {
  it('wins over Settings for that ticket only', async () => {
    const permissions = createPermissionService({
      settings: { get: () => ({ ...defaultSettings(), agentPermissions: { ...defaultAgentPermissions(), mode: 'auto' } }) },
      buildCommands: { forRepo: async () => ({ ok: true, data: dotnet }) },
      emit: recordingEmit().emit,
    });
    const tickets = await memoryTickets({ id: '71273' }, { id: '71274' });
    await tickets.update('71273', (record) => ({ ...record, permissionMode: 'ask' }));
    expect((await permissions.sessionExtras((await tickets.get('71273'))!)).permissionMode).toBe('default');
    expect((await permissions.sessionExtras((await tickets.get('71274'))!)).permissionMode).toBe('auto');
  });
});

describe('a read-only reviewer (AL-266)', () => {
  async function reviewer() {
    const system: string[] = [];
    const tickets = await memoryTickets({ id: '71273' });
    const lead = (await tickets.get('71273'))!;
    const created = await tickets.create({ ...newTicketInput(SESSION_TEST_BASE, { id: '71273-reviewer-eyes', branch: lead.branch, worktreePath: lead.worktreePath }), ado: null, companion: { of: '71273', role: 'reviewer', name: 'Eyes' } });
    if (!created.ok) throw new Error(created.message);
    const events = recordingEmit();
    const permissions = createPermissionService({
      settings: { get: () => defaultSettings() },
      tickets,
      buildCommands: { forRepo: async () => ({ ok: true, data: dotnet }) },
      emit: events.emit,
      transcripts: { appendSystem: (_ticketId: string, text: string) => void system.push(text) } as never,
    });
    const extras = await permissions.sessionExtras((await tickets.get('71273-reviewer-eyes'))!);
    const leadExtras = await permissions.sessionExtras(lead);
    return { permissions, extras, leadExtras, events, system };
  }

  it('runs without its write tools, and a PreToolUse hook refuses them and worktree-changing commands', async () => {
    const { extras, leadExtras, system } = await reviewer();
    expect(extras.disallowedTools).toEqual(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
    expect(leadExtras.disallowedTools).toBeUndefined();
    const matcher = extras.hooks?.PreToolUse?.[1];
    if (!matcher) throw new Error('no read-only hook');
    expect(new RegExp(matcher.matcher!).test('Edit')).toBe(true);
    expect(new RegExp(matcher.matcher!).test('Read')).toBe(false);
    const hook = (tool: string, input: Record<string, unknown>) =>
      matcher.hooks[0]!({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: 'toolu_9' } as never, 'toolu_9', { signal: new AbortController().signal });
    await expect(hook('Edit', { file_path: 'a.cs' })).resolves.toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('read-only reviewer') } });
    await expect(hook('Bash', { command: 'rm -rf bin' })).resolves.toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    await expect(hook('Bash', { command: 'git status' })).resolves.toEqual({});
    await expect(hook('Bash', { command: 'dotnet build OnSite.sln -c Debug' })).resolves.toEqual({});
    expect(system).toEqual(['Agent Lanes refused Edit: this agent is read-only', 'Agent Lanes refused Bash: this agent is read-only']);
    // The lead's hooks are untouched: only the comment gate.
    expect(leadExtras.hooks?.PreToolUse).toHaveLength(1);
  });

  it('canUseTool denies the same calls with a message, never a Needs-you prompt; the lead still asks', async () => {
    const { permissions, events } = await reviewer();
    await expect(permissions.canUseTool('71273-reviewer-eyes')('Write', { file_path: 'a.cs', content: '' }, context())).resolves.toMatchObject({ behavior: 'deny', message: expect.stringContaining('read-only') });
    await expect(permissions.canUseTool('71273-reviewer-eyes')('Bash', { command: 'echo hi > a.txt' }, context())).resolves.toMatchObject({ behavior: 'deny' });
    await expect(permissions.canUseTool('71273-reviewer-eyes')('Bash', { command: 'git log -3' }, context())).resolves.toMatchObject({ behavior: 'allow' });
    expect(permissions.pending('71273-reviewer-eyes')).toBeNull();
    expect(events.of('agent:permission')).toEqual([]);
    const asked = permissions.canUseTool('71273')('Bash', { command: 'echo hi > a.txt' }, context());
    expect(permissions.pending('71273')).not.toBeNull();
    permissions.cancelAll('71273');
    await asked;
  });
});
