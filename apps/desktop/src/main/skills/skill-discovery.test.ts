import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { defaultSettings, type Settings } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createFakeClaude } from '../agent/testing/fake-claude';
import { fakeClaudeConnections } from '../agent/testing/sessions';
import { REPO_NOT_REGISTERED_MESSAGE, createSkillDiscovery, skillsFrom } from './skill-discovery';

const REPO = 'C:\\src\\onsite-companion';

function settingsWith(...paths: string[]): { get: () => Settings } {
  const settings = defaultSettings();
  return {
    get: () => ({
      ...settings,
      repos: paths.map((path) => ({
        path,
        name: 'onsite-companion',
        baseBranch: 'main',
        worktreeRoot: 'C:\\src\\.agent-lanes',
        buildCommand: null,
        runCommand: null,
        maxConcurrentAgents: 3,
      })),
    }),
  };
}

/** What Claude Code lists in a repo with its own skill, the user's skills, a plugin skill, built-ins and an MCP prompt. */
const COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Clear the conversation but keep a summary', argumentHint: '', builtin: true },
  { name: 'usage', description: 'Show usage', argumentHint: '', aliases: ['cost'], builtin: true },
  // The repo's own .claude/skills/osc-blazor-cutover-invoke/SKILL.md.
  { name: 'osc-blazor-cutover-invoke', description: 'Recursive VB WinForms to Blazor cutover', argumentHint: '<form>' },
  // The user's ~/.claude/skills.
  { name: 'code-review', description: 'Review the current diff', argumentHint: '' },
  { name: 'commit', description: 'Commit in logical groups', argumentHint: '' },
  { name: 'ai-tools:sop-check', description: 'Check the branch against the SOPs', argumentHint: '' },
  { name: 'mcp__ado__triage', description: 'An MCP prompt', argumentHint: '' },
];

function discovery(commands: SlashCommand[] | Error | 'hang' = COMMANDS, options: { timeoutMs?: number; paths?: string[] } = {}) {
  const fake = createFakeClaude({ live: true, commands });
  const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query });
  const service = createSkillDiscovery({
    claude,
    connections: fakeClaudeConnections(),
    settings: settingsWith(...(options.paths ?? [REPO])),
    timeoutMs: options.timeoutMs,
    now: () => 42,
  });
  return { fake, service };
}

describe('skill discovery (AL-114)', () => {
  it("lists the repo's own skills and the user's skills, without built-ins or MCP prompts", async () => {
    const { fake, service } = discovery();
    const result = await service.list(REPO);

    expect(result).toEqual({
      ok: true,
      data: {
        repo: REPO,
        loadedAt: 42,
        skills: [
          { name: 'ai-tools:sop-check', description: 'Check the branch against the SOPs', argumentHint: '' },
          { name: 'code-review', description: 'Review the current diff', argumentHint: '' },
          { name: 'commit', description: 'Commit in logical groups', argumentHint: '' },
          { name: 'osc-blazor-cutover-invoke', description: 'Recursive VB WinForms to Blazor cutover', argumentHint: '<form>' },
        ],
      },
    });

    // A session with the repo's configuration: its main checkout, user + project + local settings.
    const call = fake.calls[0]!;
    expect(call.options.cwd).toBe(REPO);
    expect(call.options.settingSources).toEqual(['user', 'project', 'local']);
    expect(call.options.persistSession).toBe(false);
    // Nothing is asked of the model, and the process is closed afterwards.
    expect(call.sent).toEqual([]);
    expect(call.closed).toBe(true);
  });

  it('caches per repo, shares a load in flight, and asks again on refresh', async () => {
    const { fake, service } = discovery();
    const [first, second] = await Promise.all([service.list(REPO), service.list(REPO.toLowerCase())]);
    expect(first).toEqual(second);
    expect(fake.calls).toHaveLength(1);

    await service.list(REPO);
    expect(fake.calls).toHaveLength(1);
    await service.list(REPO, { refresh: true });
    expect(fake.calls).toHaveLength(2);
  });

  it('refuses a repo that is not registered without starting Claude Code', async () => {
    const { fake, service } = discovery(COMMANDS, { paths: [] });
    expect(await service.list('C:\\Windows')).toEqual({ ok: false, code: 'VALIDATION', message: REPO_NOT_REGISTERED_MESSAGE });
    expect(fake.calls).toHaveLength(0);
  });

  it('reports a failure and a timeout, and closes the process either way', async () => {
    const failing = discovery(new Error('initialize failed'));
    expect(await failing.service.list(REPO)).toMatchObject({ ok: false, code: 'INTERNAL', message: expect.stringContaining('initialize failed') });
    expect(failing.fake.calls[0]?.closed).toBe(true);

    const slow = discovery('hang', { timeoutMs: 20 });
    expect(await slow.service.list(REPO)).toMatchObject({ ok: false, code: 'INTERNAL', message: expect.stringContaining('did not list its skills') });
    expect(slow.fake.calls[0]?.closed).toBe(true);
  });

  it('keeps one entry per name', () => {
    expect(skillsFrom([...COMMANDS, { name: '/code-review', description: 'again', argumentHint: '' }]).filter((skill) => skill.name === 'code-review')).toHaveLength(1);
  });
});
