import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createAdoClient, setWorkItemAssignment } from '@agent-lanes/ado-client';
import { createFakeTeamOrg, FAKE_TEAM_PROJECT, PEOPLE } from '@agent-lanes/ado-client/testing';
import { LAUNCH_UNDO_WINDOW_MS, ok } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { LaunchUndoEntry } from './launch-from-ado';
import type { SessionMessageListener } from './session-manager';
import { createLaunchUndo, type LaunchUndoOptions } from './undo-launch';

/** Kyle dropped To Do item #71335 on Planning: it is assigned to him and Active (rev 4). */
async function setUp() {
  const org = createFakeTeamOrg();
  const client = createAdoClient({ orgUrl: org.orgUrl, pat: org.pat, fetch: org.fetch, sleep: async () => undefined });
  if (!client.ok) throw new Error(client.message);
  const assigned = await setWorkItemAssignment(client.data, { project: FAKE_TEAM_PROJECT, workItemId: 71335 }, { expectedRev: 3, assignee: PEOPLE.KR.uniqueName, state: 'Active' });
  if (!assigned.ok) throw new Error(assigned.message);

  let clock = 1_000;
  const entry: LaunchUndoEntry = {
    undoId: 'u'.repeat(48),
    ticketId: '71335',
    lane: 'planning',
    org: 'ado:companionsystems',
    ado: { project: FAKE_TEAM_PROJECT, workItemId: 71335, previousAssignee: null, previousState: 'New', rev: assigned.data.rev },
    review: false,
    createdAt: clock,
  };
  const entries = new Map([[entry.undoId, entry]]);
  const listeners: SessionMessageListener[] = [];
  const deps = {
    launcher: {
      undoEntry: (id: string) => entries.get(id),
      undoEntryForTicket: (ticketId: string) => [...entries.values()].find((candidate) => candidate.ticketId === ticketId),
      forgetUndo: (id: string) => void entries.delete(id),
    },
    sessions: {
      stop: vi.fn(async () => ok(true)),
      subscribe: (listener: SessionMessageListener) => {
        listeners.push(listener);
        return () => undefined;
      },
    },
    launches: { cancel: vi.fn(() => false) },
    worktrees: { discard: vi.fn(async () => ok({ complete: true, leftovers: [] as string[] })) },
    ado: { clientFor: async () => ok(client.data) },
    emit: vi.fn(),
    now: () => clock,
  };
  const undo = createLaunchUndo(deps as unknown as LaunchUndoOptions);
  const item = () => org.state.workItems.items.find((candidate) => candidate.id === 71335)!;
  const send = (message: unknown) => listeners.forEach((listener) => listener({ ticketId: '71335', cwd: 'C:\\x', resumed: false, message: message as SDKMessage }));
  return { undo, deps, entry, item, send, tick: (ms: number) => (clock += ms) };
}

const toolUse = (name: string, input: Record<string, unknown>) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name, input }] } });

describe('undo a launch (AL-237)', () => {
  it('within 10 s puts the item back and removes the agent, worktree and ticket', async () => {
    const { undo, deps, entry, item, tick } = await setUp();
    tick(LAUNCH_UNDO_WINDOW_MS - 100);

    const result = await undo.undo(entry.undoId);

    expect(result).toEqual({
      ok: true,
      data: { ticketId: '71335', worktreeRemoved: true, leftovers: [], adoRestored: true, summary: '#71335 is back in New, unassigned · the worktree and agent are gone' },
    });
    expect(item()).toMatchObject({ state: 'New', boardColumn: 'To Do' });
    expect(item().assignedTo).toBeUndefined();
    expect(deps.launches.cancel).toHaveBeenCalledWith('71335');
    expect(deps.sessions.stop).toHaveBeenCalledWith('71335');
    expect(deps.worktrees.discard).toHaveBeenCalledWith('71335');
    // Once only.
    await expect(undo.undo(entry.undoId)).resolves.toMatchObject({ ok: false, details: { reason: 'expired' } });
  });

  it('after 10 s says what to revert by hand and changes nothing', async () => {
    const { undo, deps, entry, item, tick } = await setUp();
    tick(LAUNCH_UNDO_WINDOW_MS + 5_000);
    const result = await undo.undo(entry.undoId);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'expired' } });
    expect(result.ok ? '' : result.message).toContain('set #71335 back to New and unassign it in Azure DevOps, then archive 71335');
    expect(item()).toMatchObject({ state: 'Active', assignedTo: PEOPLE.KR });
    expect(deps.worktrees.discard).not.toHaveBeenCalled();
  });

  it("ends when the agent's first turn ends", async () => {
    const { undo, deps, entry, send } = await setUp();
    send({ type: 'result', subtype: 'success' });
    await expect(undo.undo(entry.undoId)).resolves.toMatchObject({ ok: false, details: { reason: 'turn-ended' } });
    expect(deps.emit).toHaveBeenCalledWith('toast', expect.objectContaining({ id: 'launch-from-ado:71335', title: 'Undo is no longer available' }));
    expect(deps.worktrees.discard).not.toHaveBeenCalled();
  });

  it('is no longer offered once the agent pushed or posted comments, and the toast says what to revert by hand', async () => {
    const pushed = await setUp();
    pushed.send(toolUse('Bash', { command: 'git push origin 71335-client-portal' }));
    await expect(pushed.undo.undo(pushed.entry.undoId)).resolves.toMatchObject({ ok: false, details: { reason: 'pushed' } });
    expect(pushed.deps.emit).toHaveBeenCalledWith('toast', {
      id: 'launch-from-ado:71335',
      tone: 'warning',
      title: 'Undo is no longer available',
      body: 'The agent already pushed its branch. To revert by hand: delete the branch on origin, set #71335 back to New and unassign it in Azure DevOps, then archive 71335 to remove its worktree.',
    });

    const commented = await setUp();
    commented.send(toolUse('mcp__azure-devops__repo_create_pull_request_thread', { pullRequestId: 10598 }));
    await expect(commented.undo.undo(commented.entry.undoId)).resolves.toMatchObject({ ok: false, details: { reason: 'commented' } });

    // Reading is fine.
    const reading = await setUp();
    reading.send(toolUse('Bash', { command: 'git log --oneline -5' }));
    reading.send(toolUse('mcp__azure-devops__repo_list_pull_request_threads', {}));
    await expect(reading.undo.undo(reading.entry.undoId)).resolves.toMatchObject({ ok: true });
  });
});

describe('undo after a real drop (AL-237): ADO and disk exactly as before', () => {
  it('Failed item dropped on Planning, then Undo within 10 s', { timeout: 120_000 }, async () => {
    const { mkdtemp, readdir, rm } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomBytes } = await import('node:crypto');
    const { createTempRepo } = await import('../git/testing');
    const { createGitService } = await import('../git/git-service');
    const { createTicketWorktreeService } = await import('../worktrees');
    const { createTicketRecordStore } = await import('../tickets');
    const { createSettingsService } = await import('../settings/service');
    const { createMemorySettingsFile } = await import('../settings/settings-file');
    const { createRepoSettings } = await import('../settings/repo-settings');
    const { createConnectionsService } = await import('../connections');
    const { createMemoryConnectionsFile } = await import('../connections/connections-file');
    const { SECRETS_FILE_NAME, createSecretStore } = await import('../secrets');
    const { createFakeSafeStorage } = await import('../secrets/testing');
    const { createAdoService } = await import('../ado/service');
    const { createAdoLauncher } = await import('./launch-from-ado');
    const { FAKE_TEAM_ORG_URL, FAKE_TEAM_PAT } = await import('@agent-lanes/ado-client/testing');

    const repo = await createTempRepo();
    const dir = await mkdtemp(join(tmpdir(), 'agent-lanes-undo-'));
    const tickets = createTicketRecordStore({ rootDir: join(dir, 'tickets'), warn: () => undefined });
    try {
      const org = createFakeTeamOrg();
      const secrets = createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key: randomBytes(32) }), warn: () => undefined });
      const connections = createConnectionsService({ file: createMemoryConnectionsFile(), secrets, emit: () => undefined, warn: () => undefined });
      const saved = await connections.save({ kind: 'ado', orgUrl: FAKE_TEAM_ORG_URL, pat: FAKE_TEAM_PAT, defaultProject: FAKE_TEAM_PROJECT });
      if (!saved.ok) throw new Error(saved.message);
      const settings = createSettingsService({ file: createMemorySettingsFile(), warn: () => undefined });
      settings.update({ repos: [createRepoSettings(repo.dir, { baseBranch: 'main' })] });
      const ado = createAdoService({ connections, settings, fetch: org.fetch });
      const git = createGitService({ runner: repo.git });
      const worktrees = createTicketWorktreeService({ git, settings, tickets, rollbackRetryDelaysMs: [0, 0] });
      const launches = { launch: vi.fn(async ({ ticketId }: { ticketId: string }) => ok({ ticketId, state: 'running' as const, sessionId: null, message: null })), cancel: vi.fn(() => false) };
      const launcher = createAdoLauncher({ ado, connections, worktrees, launches, tickets, settings, repoForPullRequest: async () => null });
      const undo = createLaunchUndo({
        launcher,
        sessions: { stop: vi.fn(async () => ok(false)), subscribe: () => () => undefined },
        launches,
        worktrees,
        ado,
        emit: vi.fn(),
      } as unknown as LaunchUndoOptions);

      const item = () => org.state.workItems.items.find((candidate) => candidate.id === 71318)!;
      delete item().assignedTo;
      const adoBefore = { ...item() };
      const disk = async () => ({
        branches: await repo.exec(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
        worktrees: await repo.exec(['worktree', 'list', '--porcelain']),
        root: existsSync(join(repo.root, '.agent-lanes')) ? await readdir(join(repo.root, '.agent-lanes')) : null,
        records: (await tickets.list()).map((record) => record.id),
      });
      const diskBefore = await disk();

      const launched = await launcher.launch({ source: { kind: 'board-item', id: 71318, team: 'OSC Developers', sprint: 'OnSite Companion\\Sprint 42' }, lane: 'planning', repo: repo.dir });
      if (!launched.ok) throw new Error(launched.message);
      expect(item()).toMatchObject({ state: 'Active', assignedTo: PEOPLE.KR });
      expect((await disk()).records).toEqual(['71318']);

      await expect(undo.undo(launched.data.undoId)).resolves.toMatchObject({ ok: true, data: { worktreeRemoved: true, adoRestored: true } });
      expect({ ...item() }).toEqual({ ...adoBefore, rev: 5 });
      expect(await disk()).toEqual(diskBefore);
    } finally {
      await tickets.dispose();
      await repo.cleanup();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
