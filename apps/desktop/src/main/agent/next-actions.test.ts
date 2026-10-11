import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from './claude-sdk';
import { createNextActionsService, nextActionsPrompt } from './next-actions';
import { createFakeClaude, fakeInit, fakeResult } from './testing/fake-claude';
import { fakeClaudeConnections } from './testing/sessions';

const DIGEST = '- #71273 "Cutover frmJobControl to Blazor" · Implementing · Waiting for you · Waiting for you · approve planning';

describe('next actions for the board digest (AL-272)', () => {
  it('asks one tool-less session for a next step per ticket and returns them', async () => {
    const result = { ...fakeResult({ result: '{"actions":[]}' }), structured_output: { actions: [{ ticketId: '71273', text: 'Approve the plan so the agent can start building.' }] } } as unknown as SDKMessage;
    const fake = createFakeClaude({ live: false, messages: [fakeInit('digest-session'), result] });
    const service = createNextActionsService({ claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }), connections: fakeClaudeConnections(), cwd: 'C:\\app' });

    await expect(service.generate({ digest: DIGEST })).resolves.toEqual({ ok: true, data: { model: 'sonnet', actions: [{ ticketId: '71273', text: 'Approve the plan so the agent can start building.' }] } });
    const call = fake.calls[0]!;
    expect(call.options.tools).toEqual([]);
    expect(call.options.maxTurns).toBe(1);
    expect(call.options.persistSession).toBe(false);
    expect(call.options.cwd).toBe('C:\\app');
    expect(String(call.prompt)).toContain(DIGEST);
    expect(nextActionsPrompt(DIGEST)).toContain('Reply with JSON only');
  });

  it('reports a session that fails or answers in the wrong shape, and refuses without a Claude connection', async () => {
    const wrong = { ...fakeResult({ result: 'nope' }), structured_output: { actions: 'x' } } as unknown as SDKMessage;
    const fake = createFakeClaude({ live: false, messages: [fakeInit('s'), wrong] });
    const service = createNextActionsService({ claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }), connections: fakeClaudeConnections(), cwd: 'C:\\app' });
    await expect(service.generate({ digest: DIGEST })).resolves.toMatchObject({ ok: false, code: 'INTERNAL', message: 'Next actions came back in an unexpected shape.' });

    const failing = createFakeClaude({ live: false, messages: [fakeInit('s'), fakeResult({ is_error: true, result: 'rate limited' })] });
    const failingService = createNextActionsService({ claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => failing.query }), connections: fakeClaudeConnections(), cwd: 'C:\\app' });
    await expect(failingService.generate({ digest: DIGEST })).resolves.toMatchObject({ ok: false, code: 'INTERNAL' });

    const offline = createNextActionsService({ claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }), connections: fakeClaudeConnections('none'), cwd: 'C:\\app' });
    await expect(offline.generate({ digest: DIGEST })).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
