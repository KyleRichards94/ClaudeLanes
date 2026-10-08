import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeAdoOrg, type FakeAdoOrg } from '@agent-lanes/ado-client/testing';
import { ADO_FIXTURE_ORG_ID, ADO_FIXTURE_ORG_URL, ADO_FIXTURE_PROJECT, ADO_FIXTURE_REPOSITORY } from '@agent-lanes/contracts/testing';
import type { AgentTranscript, Lane } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdoService } from '../ado';
import { memoryTickets, recordingEmit } from '../agent/testing/sessions';
import { createConnectionsService } from '../connections';
import { createMemoryConnectionsFile } from '../connections/connections-file';
import type { GitRunner } from '../git/git-runner';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createSettingsService } from '../settings/service';
import { createMemorySettingsFile } from '../settings/settings-file';
import { agentSummary, createPullRequestService, draftPullRequestText } from './service';

/**
 * AL-181: the Create PR stage against the shared fake Azure DevOps organisation (MSW handlers run
 * in-process), the real AdoService and ConnectionsService, and a fake git runner. Nothing leaves the process.
 */

const REMOTE = `${ADO_FIXTURE_ORG_URL}/${encodeURIComponent(ADO_FIXTURE_PROJECT)}/_git/${ADO_FIXTURE_REPOSITORY.name}`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-pr-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function transcriptWith(text: string): AgentTranscript {
  return {
    ticketId: '71273',
    events: [
      { ticketId: '71273', at: 1, seq: 1, item: { kind: 'text', streamId: 'a', text: 'Planning the cutover.', parentToolUseId: null } },
      { ticketId: '71273', at: 2, seq: 2, item: { kind: 'text', streamId: 'b', text: 'Sub-agent notes', parentToolUseId: 'toolu_1' } },
      { ticketId: '71273', at: 3, seq: 3, item: { kind: 'text', streamId: 'c', text, parentToolUseId: null } },
    ],
    lastSeq: 3,
  };
}

async function setup(options: { stage?: Lane; remote?: string; pushFails?: boolean } = {}) {
  const fake: FakeAdoOrg = createFakeAdoOrg();
  // The fixture's PR !10612 is from the ticket's branch; start without it, as before Create PR.
  fake.state.pullRequests = fake.state.pullRequests.filter(({ pullRequest }) => pullRequest.sourceBranch !== '71273-cutover-frmjobcontrol-to');
  const secrets = createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key: randomBytes(32) }), warn: () => undefined });
  const connections = createConnectionsService({ file: createMemoryConnectionsFile(), secrets, emit: () => undefined, warn: () => undefined });
  const saved = await connections.save({ kind: 'ado', orgUrl: ADO_FIXTURE_ORG_URL, pat: fake.pat, defaultProject: ADO_FIXTURE_PROJECT });
  if (!saved.ok) throw new Error(saved.message);
  const settings = createSettingsService({ file: createMemorySettingsFile(), warn: () => undefined });
  const ado = createAdoService({ connections, settings, fetch: fake.fetch });
  const tickets = await memoryTickets({ id: '71273', stage: options.stage ?? 'create-pr' });
  const events = recordingEmit();
  const appendSystem = vi.fn();
  const gitCalls: Array<{ args: readonly string[]; cwd: string }> = [];
  const git: GitRunner = async (args, call) => {
    gitCalls.push({ args, cwd: call.cwd });
    if (args[0] === 'remote') return { stdout: `${options.remote ?? REMOTE}\n`, stderr: '', exitCode: 0 };
    if (args[0] === 'push' && options.pushFails) throw new Error('remote rejected');
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  const service = createPullRequestService({
    tickets,
    ado,
    connections,
    git,
    emit: events.emit,
    transcripts: { get: async () => transcriptWith('Cut over **frmJobControl** to JobControl.razor with bUnit tests.'), appendSystem },
    now: () => 5_000,
  });
  return { fake, tickets, events, appendSystem, gitCalls, service };
}

describe('pull request drafts (AL-181)', () => {
  it("takes the title from the ticket and the description from the agent's last summary", () => {
    expect(agentSummary(transcriptWith('All done: grid, filters and tests.'))).toBe('All done: grid, filters and tests.');
    const text = draftPullRequestText(
      { id: '71273', title: 'Cutover frmJobControl to Blazor', branch: '71273-cutover' } as Parameters<typeof draftPullRequestText>[0],
      'All done.',
    );
    expect(text.title).toBe('Cutover frmJobControl to Blazor');
    expect(text.description).toBe('All done.\n\nOpened by Agent Lanes from ticket 71273 (branch `71273-cutover`).');
  });

  it('drafts from the record and the transcript and says where the PR goes', async () => {
    const { service } = await setup();
    const draft = await service.draft('71273');
    expect(draft).toEqual({
      ok: true,
      data: {
        title: 'Cutover frmJobControl to Blazor',
        description: expect.stringContaining('Cut over **frmJobControl** to JobControl.razor with bUnit tests.'),
        sourceBranch: '71273-cutover-frmjobcontrol-to',
        targetBranch: 'main',
        workItemId: 71273,
        repository: `${ADO_FIXTURE_PROJECT} / ${ADO_FIXTURE_REPOSITORY.name}`,
        blocked: null,
      },
    });
  });

  it('says why a PR cannot be created before Create PR or without an Azure Repos remote', async () => {
    const early = await setup({ stage: 'qa' });
    await expect(early.service.draft('71273')).resolves.toMatchObject({ ok: true, data: { blocked: expect.stringContaining('Create PR') } });
    await expect(early.service.create({ ticketId: '71273', title: 'T', description: '' })).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });

    const github = await setup({ remote: 'https://github.com/contoso/onsite.git' });
    await expect(github.service.draft('71273')).resolves.toMatchObject({ ok: true, data: { repository: null, blocked: expect.stringContaining('Azure Repos') } });
  });
});

describe('creating the PR (AL-181)', () => {
  it('pushes the ticket branch, opens the PR linked to the work item in ADO, and keeps it on the record', async () => {
    const { fake, tickets, events, appendSystem, gitCalls, service } = await setup();

    const created = await service.create({ ticketId: '71273', title: 'Cutover frmJobControl to Blazor', description: 'Edited by Kyle' });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(gitCalls.find((call) => call.args[0] === 'push')).toEqual({
      args: ['push', '--quiet', '--porcelain', '--set-upstream', 'origin', 'refs/heads/71273-cutover-frmjobcontrol-to:refs/heads/71273-cutover-frmjobcontrol-to'],
      cwd: expect.stringContaining('71273'),
    });
    // The acceptance criterion: ADO holds the PR linked to the work item.
    const inAdo = fake.state.pullRequests.find(({ pullRequest }) => pullRequest.id === created.data.pullRequest.id)?.pullRequest;
    expect(inAdo).toMatchObject({
      title: 'Cutover frmJobControl to Blazor',
      description: 'Edited by Kyle',
      sourceBranch: '71273-cutover-frmjobcontrol-to',
      targetBranch: 'main',
      status: 'active',
      workItemIds: [71273],
    });
    expect(created.data).toMatchObject({ created: true, snapshot: { checks: { passed: 0, total: 2 } } });

    const record = await tickets.get('71273');
    expect(record?.pullRequest).toEqual({
      ref: { project: expect.any(String), repository: ADO_FIXTURE_REPOSITORY.id, pullRequestId: inAdo!.id },
      org: ADO_FIXTURE_ORG_ID,
      id: inAdo!.id,
      webUrl: expect.stringContaining(`/pullrequest/${inAdo!.id}`),
      status: 'active',
      openedAt: 5_000,
      closedAt: null,
    });
    expect(events.of('pr:status')).toEqual([
      { ticketId: '71273', pullRequestId: inAdo!.id, status: 'active', checks: { passed: 0, total: 2, pending: 2 }, webUrl: expect.any(String) },
    ]);
    expect(appendSystem).toHaveBeenCalledWith('71273', `PR !${inAdo!.id} opened · 71273-cutover-frmjobcontrol-to → main · linked to #71273`);
    service.dispose();
  });

  it('opens nothing when the push fails', async () => {
    const { fake, tickets, service } = await setup({ pushFails: true });
    const before = fake.state.pullRequests.length;
    await expect(service.create({ ticketId: '71273', title: 'T', description: '' })).resolves.toMatchObject({ ok: false, details: { reason: 'push-failed' } });
    expect(fake.state.pullRequests).toHaveLength(before);
    expect((await tickets.get('71273'))?.pullRequest ?? null).toBeNull();
  });

  it('returns the open PR instead of opening a second one', async () => {
    const { fake, service } = await setup();
    const first = await service.create({ ticketId: '71273', title: 'T', description: '' });
    const second = await service.create({ ticketId: '71273', title: 'T', description: '' });
    expect(second).toMatchObject({ ok: true, data: { created: false, pullRequest: { id: first.ok ? first.data.pullRequest.id : -1 } } });
    expect(fake.state.pullRequests.filter(({ pullRequest }) => pullRequest.sourceBranch === '71273-cutover-frmjobcontrol-to')).toHaveLength(1);
    service.dispose();
  });
});

describe('watching the PR (AL-181)', () => {
  it('sends checks as they change and moves the ticket to Done once the PR is completed', async () => {
    const { fake, tickets, events, appendSystem, service } = await setup();
    const created = await service.create({ ticketId: '71273', title: 'T', description: '' });
    if (!created.ok) throw new Error(created.message);
    const entry = fake.state.pullRequests.find(({ pullRequest }) => pullRequest.id === created.data.pullRequest.id)!;

    // Unchanged: nothing new is sent.
    await service.refresh('71273');
    expect(events.of('pr:status')).toHaveLength(1);

    entry.pullRequest.status = 'completed';
    entry.pullRequest.closedAt = new Date(6_000).toISOString();
    const refreshed = await service.refresh('71273');
    expect(refreshed).toMatchObject({ ok: true, data: { pullRequest: { status: 'completed', closedAt: 5_000 } } });

    const record = await tickets.get('71273');
    expect(record?.stage).toBe('done');
    expect(events.of('agent:stage')).toEqual([
      { ticketId: '71273', change: 'stage', stage: 'done', from: 'create-pr', activity: `PR !${entry.pullRequest.id} · merged`, progress: 0 },
    ]);
    expect(events.of('pr:status').at(-1)).toMatchObject({ status: 'completed' });
    expect(appendSystem).toHaveBeenLastCalledWith('71273', `PR !${entry.pullRequest.id} merged · moved to Done`);

    // Reading it again does not move the ticket twice.
    await service.refresh('71273');
    expect(events.of('agent:stage')).toHaveLength(1);
    service.dispose();
  });

  it('moves an abandoned PR to Done too, and reads open PRs on a timer', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { fake, tickets, service } = await setup();
      const created = await service.create({ ticketId: '71273', title: 'T', description: '' });
      if (!created.ok) throw new Error(created.message);
      fake.state.pullRequests.find(({ pullRequest }) => pullRequest.id === created.data.pullRequest.id)!.pullRequest.status = 'abandoned';

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(async () => expect((await tickets.get('71273'))?.stage).toBe('done'));
      expect((await tickets.get('71273'))?.pullRequest?.status).toBe('abandoned');
      service.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers null for a ticket without a PR', async () => {
    const { service } = await setup();
    await expect(service.refresh('71273')).resolves.toEqual({ ok: true, data: null });
  });
});
