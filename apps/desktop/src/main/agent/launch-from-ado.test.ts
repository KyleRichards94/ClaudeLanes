import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeTeamOrg, FAKE_TEAM_ORG_URL, FAKE_TEAM_PAT, FAKE_TEAM_PROJECT, PEOPLE, type FakeTeamOrg } from '@agent-lanes/ado-client/testing';
import {
  err,
  ok,
  type ActivePullRequest,
  type AgentSessionStatus,
  type AdoScope,
  type ConnectionSummary,
  type LaunchFromAdoRequest,
  type Result,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdoService } from '../ado/service';
import { createConnectionsService, type ConnectionsService } from '../connections';
import { createMemoryConnectionsFile } from '../connections/connections-file';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createSettingsService } from '../settings/service';
import { createMemorySettingsFile } from '../settings/settings-file';
import type { CreateTicketWorktreeInput } from '../worktrees';
import { createAdoLauncher, type AdoLauncherOptions } from './launch-from-ado';

/**
 * AL-236 against the fake CompanionSystems organisation (artboard 08's board and PRs), signed in as
 * Kyle: the drop transaction's recheck, its one ADO change, the worktree it asks for, and rollback.
 */

const REPO = 'C:\\src\\onsite-companion';
const SPRINT = 'OnSite Companion\\Sprint 42';
const ONSITE_REMOTE = { orgUrl: FAKE_TEAM_ORG_URL, project: FAKE_TEAM_PROJECT, repository: 'onsite-companion' };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-launch-ado-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function recordFor(input: CreateTicketWorktreeInput): TicketRecord {
  const subject = input.subject;
  const id =
    subject.kind === 'work-item' ? String(subject.ado.workItemId) : subject.kind === 'pull-request' ? (subject.purpose === 'answer' ? `pr-${subject.pullRequestId}` : `pr-${subject.pullRequestId}-review`) : 'nt-x';
  return {
    version: 1,
    id,
    title: subject.kind === 'no-ticket' ? subject.description : subject.title,
    ado: subject.kind === 'work-item' ? subject.ado : null,
    repo: input.repo,
    baseBranch: input.baseBranch ?? 'main',
    branch: input.checkout?.branch ?? `${id}-branch`,
    worktreePath: `C:\\src\\.agent-lanes\\${id}`,
    subBranches: [],
    stage: 'queued',
    stageHistory: [{ stage: 'queued', at: 1 }],
    gates: input.gates!,
    model: input.model!,
    effort: input.effort!,
    skills: input.skills ?? [],
    sessionId: null,
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    createdAt: 1,
    updatedAt: 1,
  };
}

interface SetUpOptions {
  missingScopes?: AdoScope[];
  create?: (input: CreateTicketWorktreeInput) => Result<{ record: TicketRecord }>;
  start?: (ticketId: string) => Result<AgentSessionStatus>;
  records?: TicketRecord[];
  laneDefaults?: AdoLauncherOptions['laneDefaults'];
}

async function setUp(options: SetUpOptions = {}) {
  const org: FakeTeamOrg = createFakeTeamOrg();
  const secrets = createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key: randomBytes(32) }), warn: () => undefined });
  const real = createConnectionsService({ file: createMemoryConnectionsFile(), secrets, emit: () => undefined, warn: () => undefined });
  const saved = await real.save({ kind: 'ado', orgUrl: FAKE_TEAM_ORG_URL, pat: FAKE_TEAM_PAT, defaultProject: FAKE_TEAM_PROJECT });
  if (!saved.ok) throw new Error(saved.message);
  const withScopes = (row: ConnectionSummary | undefined) => (row?.kind === 'ado' && options.missingScopes ? { ...row, missingScopes: options.missingScopes } : row);
  const connections: Pick<ConnectionsService, 'get' | 'list' | 'secret'> = {
    get: async (id) => withScopes(await real.get(id)),
    list: async () => (await real.list()).map((row) => withScopes(row)!),
    secret: (id) => real.secret(id),
  };
  const settings = createSettingsService({ file: createMemorySettingsFile(), warn: () => undefined });
  settings.update({
    repos: [{ path: REPO, name: 'onsite-companion', baseBranch: 'main', worktreeRoot: 'C:\\src\\.agent-lanes', buildCommand: null, runCommand: null, maxConcurrentAgents: 3 }],
  });
  const ado = createAdoService({ connections, settings, fetch: org.fetch, registeredRemotes: async () => [ONSITE_REMOTE] });
  const saveds = new Map<string, TicketRecord>((options.records ?? []).map((record) => [record.id, record]));
  const deps = {
    worktrees: {
      create: vi.fn(async (input: CreateTicketWorktreeInput) => {
        const result = options.create?.(input) ?? ok({ record: recordFor(input) });
        if (result.ok) saveds.set(result.data.record.id, result.data.record);
        return result.ok ? ok({ record: result.data.record, start: { ref: 'origin/main', commit: 'abc', fetchError: null } }) : result;
      }),
      discard: vi.fn(async (ticketId: string) => {
        saveds.delete(ticketId);
        return ok({ complete: true, leftovers: [] });
      }),
    },
    launches: {
      launch: vi.fn(async ({ ticketId }: { ticketId: string; jobDescription?: string }) => options.start?.(ticketId) ?? ok<AgentSessionStatus>({ ticketId, state: 'running', sessionId: null, message: null })),
    },
    tickets: { get: async (id: string) => saveds.get(id), list: async () => [...saveds.values()] },
  };
  const launcher = createAdoLauncher({
    ado,
    connections,
    settings,
    ...deps,
    repoForPullRequest: async (_orgUrl: string, pr: ActivePullRequest) => (pr.repository.name === 'onsite-companion' ? REPO : null),
    ...(options.laneDefaults ? { laneDefaults: options.laneDefaults } : {}),
  } as unknown as AdoLauncherOptions);
  const item = (id: number) => org.state.workItems.items.find((candidate) => candidate.id === id)!;
  /** ADO calls that change something: anything but GETs and the read-only POSTs (WIQL, workitemsbatch). */
  const writes = () => org.state.requests.filter((line) => !line.startsWith('GET ') && !/^POST .*\/_apis\/wit\/(wiql|workitemsbatch)(\?|$)/.test(line));
  return { org, launcher, deps, item, writes, orgId: saved.data.id };
}

const board = (id: number, column?: string): LaunchFromAdoRequest['source'] => ({ kind: 'board-item', id, team: 'OSC Developers', sprint: SPRINT, ...(column ? { column } : {}) });

describe('launch from the team board (AL-236)', () => {
  it('Failed item on Planning: assigns you, moves it to In Progress, then a worktree from main with the plan gate on', async () => {
    const { launcher, deps, item, writes } = await setUp();
    // Unassign it first, as a Failed item handed back to the team would be.
    delete item(71318).assignedTo;

    const result = await launcher.launch({ source: board(71318, 'Failed'), lane: 'planning', repo: REPO });

    expect(result).toMatchObject({
      ok: true,
      data: {
        ticketId: '71318',
        status: { state: 'running' },
        adoChange: { workItemId: 71318, previousAssignee: null, previousState: 'Failed UAT', state: 'Active' },
        summary: '#71318 assigned to you and moved to In Progress · agent started in Planning',
      },
    });
    expect(item(71318)).toMatchObject({ state: 'Active', boardColumn: 'In Progress', assignedTo: PEOPLE.KR });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatch(/^PATCH .*\/wit\/workitems\/71318\?/);

    const input = deps.worktrees.create.mock.calls[0]![0];
    expect(input).toMatchObject({
      repo: REPO,
      subject: { kind: 'work-item', ado: { orgUrl: FAKE_TEAM_ORG_URL, project: FAKE_TEAM_PROJECT, workItemId: 71318 }, title: 'Quote PDF totals round incorrectly' },
      model: 'opus',
      effort: 'high',
      skills: [],
      stage: 'queued',
    });
    expect(input.checkout).toBeUndefined();
    expect(input.gates?.planning).toBe('approval');
    expect(launcher.startLane('71318')).toBe('planning');
    expect(result.ok && launcher.undoEntry(result.data.undoId)).toMatchObject({ ticketId: '71318', ado: { workItemId: 71318, previousState: 'Failed UAT', previousAssignee: null } });
  });

  it('To Do item on Implementing: same ADO change, and the plan gate is skipped', async () => {
    const { launcher, deps, item } = await setUp();
    const result = await launcher.launch({ source: board(71335), lane: 'implementing', repo: REPO });
    expect(result).toMatchObject({ ok: true, data: { adoChange: { previousState: 'New', state: 'Active' } } });
    expect(item(71335)).toMatchObject({ state: 'Active', assignedTo: PEOPLE.KR });
    expect(deps.worktrees.create.mock.calls[0]![0].gates?.planning).toBe('auto');
    expect(launcher.startLane('71335')).toBe('implementing');
  });

  it('no other drop ever writes to ADO (every other TB§3 row)', async () => {
    const rows: Array<{ name: string; request: LaunchFromAdoRequest; worktree: Partial<CreateTicketWorktreeInput> }> = [
      { name: 'your In Progress item on Planning, on its branch', request: { source: board(71273), lane: 'planning', repo: REPO }, worktree: { checkout: { branch: '71273-cutover-frmjobcontrol-to' } } },
      { name: 'your In Progress item on Implementing', request: { source: board(71273), lane: 'implementing', repo: REPO }, worktree: { checkout: { branch: '71273-cutover-frmjobcontrol-to' } } },
      { name: "someone's Code Review item on Code review", request: { source: board(71298), lane: 'code-review', repo: REPO }, worktree: { checkout: { branch: 'users/ty/71298-invoice-matching', detached: true } } },
      { name: 'any open PR on Code review', request: { source: { kind: 'pull-request', id: 10598 }, lane: 'code-review' }, worktree: { checkout: { branch: 'users/ty/71298-invoice-matching', detached: true } } },
      { name: 'your PR with comments on Implementing', request: { source: { kind: 'pull-request', id: 10571 }, lane: 'implementing' }, worktree: { checkout: { branch: '71240-job-notes-editor', detached: false } } },
      { name: 'your Testing item on QA', request: { source: board(71310), lane: 'qa', repo: REPO }, worktree: { checkout: { branch: '71310-timesheet-export' } } },
    ];
    for (const row of rows) {
      const { launcher, deps, writes } = await setUp();
      const result = await launcher.launch(row.request);
      expect(result, row.name).toMatchObject({ ok: true, data: { adoChange: null } });
      expect(writes(), row.name).toEqual([]);
      expect(deps.worktrees.create.mock.calls[0]![0], row.name).toMatchObject(row.worktree);
    }

    // Refused drops write nothing either.
    for (const request of [
      { source: board(71341), lane: 'planning', repo: REPO },
      { source: board(71310, 'To Do'), lane: 'planning', repo: REPO },
      { source: { kind: 'pull-request', id: 10590 }, lane: 'code-review' },
      { source: { kind: 'pull-request', id: 10598 }, lane: 'implementing' },
      { source: board(71318), lane: 'queued', repo: REPO },
      { source: board(71318), lane: 'create-pr', repo: REPO },
    ] satisfies LaunchFromAdoRequest[]) {
      const { launcher, deps, writes } = await setUp();
      expect((await launcher.launch(request)).ok, JSON.stringify(request)).toBe(false);
      expect(writes()).toEqual([]);
      expect(deps.worktrees.create).not.toHaveBeenCalled();
    }
  });

  it('rechecks the card: refuses an item someone else has, one that moved column, and an unregistered repo with "Add repo"', async () => {
    const { launcher } = await setUp();
    await expect(launcher.launch({ source: board(71341), lane: 'planning', repo: REPO })).resolves.toMatchObject({
      ok: false,
      code: 'VALIDATION',
      message: 'Assigned to Mia Davies',
      details: { reason: 'refused' },
    });
    // The board showed #71310 in To Do; it is in Testing now.
    await expect(launcher.launch({ source: board(71310, 'To Do'), lane: 'planning', repo: REPO })).resolves.toMatchObject({
      ok: false,
      message: 'Moved to Testing — refreshed',
      details: { reason: 'moved', column: 'Testing' },
    });
    await expect(launcher.launch({ source: { kind: 'pull-request', id: 10590 }, lane: 'code-review' })).resolves.toMatchObject({
      ok: false,
      details: { reason: 'add-repo', repository: 'osc-mobile' },
    });
    await expect(launcher.launch({ source: board(99999), lane: 'planning', repo: REPO })).resolves.toMatchObject({ ok: false, details: { reason: 'not-found' } });
  });

  it('refuses a drop the token lacks the scope for, by name, with nothing changed', async () => {
    const { launcher, writes, orgId } = await setUp({ missingScopes: ['work-items'] });
    const result = await launcher.launch({ source: board(71335), lane: 'planning', repo: REPO });
    expect(result).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING', details: { scope: 'work-items', org: orgId } });
    expect(result.ok ? '' : result.message).toContain('Work Items');
    expect(writes()).toEqual([]);
  });

  it('a failure after the ADO update restores the item’s assignee and state', async () => {
    const worktreeFails = await setUp({ create: () => err('VALIDATION', 'A branch named "71335-client-portal" already exists.', { reason: 'branch-taken' }) });
    const before = { ...worktreeFails.item(71335) };
    const failed = await worktreeFails.launcher.launch({ source: board(71335), lane: 'planning', repo: REPO });
    expect(failed).toMatchObject({ ok: false, details: { reason: 'branch-taken', adoRestored: true } });
    expect(worktreeFails.item(71335)).toMatchObject({ state: before.state, boardColumn: 'To Do' });
    expect(worktreeFails.item(71335).assignedTo).toBeUndefined();

    const sessionFails = await setUp({ start: () => err('VALIDATION', 'Connect Claude in Connections before starting an agent.', { reason: 'claude-not-connected' }) });
    const result = await sessionFails.launcher.launch({ source: board(71335), lane: 'implementing', repo: REPO });
    expect(result).toMatchObject({ ok: false, details: { reason: 'claude-not-connected', ticketId: '71335', adoRestored: true, rollback: { complete: true } } });
    expect(sessionFails.deps.worktrees.discard).toHaveBeenCalledWith('71335');
    expect(sessionFails.item(71335)).toMatchObject({ state: 'New', boardColumn: 'To Do' });
    expect(sessionFails.item(71335).assignedTo).toBeUndefined();
    expect(sessionFails.launcher.startLane('71335')).toBeUndefined();
  });

  it('refuses an item that already has an agent in this app', async () => {
    const existing = recordFor({ repo: REPO, subject: { kind: 'work-item', ado: { orgUrl: FAKE_TEAM_ORG_URL, project: FAKE_TEAM_PROJECT, workItemId: 71335 }, title: 'x' }, gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' }, model: 'opus', effort: 'high' });
    const { launcher, writes } = await setUp({ records: [{ ...existing, stage: 'implementing', stageHistory: [{ stage: 'implementing', at: 1 }] }] });
    await expect(launcher.launch({ source: board(71335), lane: 'planning', repo: REPO })).resolves.toMatchObject({ ok: false, message: 'Agent in Implementing' });
    expect(writes()).toEqual([]);
  });
});

describe('pull request launches (AL-238)', () => {
  it('Code review: a read-only review that runs /code-review and posts its findings with /pr-comment-actioner', async () => {
    const { launcher, deps, writes } = await setUp();
    const result = await launcher.launch({ source: { kind: 'pull-request', id: 10598 }, lane: 'code-review' });

    expect(result).toMatchObject({ ok: true, data: { ticketId: 'pr-10598-review', adoChange: null, summary: '!10598 · agent started in Code review' } });
    expect(deps.worktrees.create.mock.calls[0]![0]).toMatchObject({
      repo: REPO,
      subject: { kind: 'pull-request', pullRequestId: 10598, title: '!10598 Supplier invoice matching rules', purpose: 'review' },
      checkout: { branch: 'users/ty/71298-invoice-matching', detached: true },
      baseBranch: 'main',
      skills: ['code-review', 'pr-comment-actioner'],
      model: 'opus',
      effort: 'high',
    });
    const job = deps.launches.launch.mock.calls[0]![0].jobDescription;
    expect(job).toContain('Run /code-review on its changes (git diff origin/main...HEAD in this worktree)');
    expect(job).toContain('with /pr-comment-actioner');
    expect(job).toContain('change no files, commit nothing and push nothing');
    expect(launcher.startLane('pr-10598-review')).toBe('code-review');
    // The app itself changes nothing in ADO: the agent posts through its skill.
    expect(writes()).toEqual([]);
  });

  it("Implementing by the PR's author: the first turn lists every unresolved thread with its file and line", async () => {
    const { launcher, deps, writes } = await setUp();
    const result = await launcher.launch({ source: { kind: 'pull-request', id: 10571 }, lane: 'implementing' });

    expect(result).toMatchObject({ ok: true, data: { ticketId: 'pr-10571', adoChange: null } });
    expect(deps.worktrees.create.mock.calls[0]![0]).toMatchObject({
      subject: { kind: 'pull-request', pullRequestId: 10571, purpose: 'answer' },
      checkout: { branch: '71240-job-notes-editor', detached: false },
      skills: ['pr-comment-actioner'],
      model: 'sonnet',
      effort: 'high',
    });
    const job = deps.launches.launch.mock.calls[0]![0].jobDescription ?? '';
    expect(job).toContain('Your pull request !10571 "Job notes rich text editor" has 6 open comment threads.');
    expect(job).toContain('Work through each one with /pr-comment-actioner: fix the code and reply, or reply why not; resolve the thread; then commit and push to 71240-job-notes-editor.');
    expect(job.split('\n').filter((line) => /^\d+\. Thread /.test(line))).toEqual([
      '1. Thread 1 · /src/Jobs/JobNotes.razor, line 10 · Tom Young: "Please rename this (1)."',
      '2. Thread 2 · /src/Jobs/JobNotesEditor.cs, line 17 · Tom Young: "Please rename this (2)."',
      '3. Thread 3 · /src/Jobs/JobNotes.razor, line 24 · Tom Young: "Please rename this (3)."',
      '4. Thread 4 · /src/Jobs/JobNotesEditor.cs, line 31 · Tom Young: "Please rename this (4)."',
      '5. Thread 5 · /src/Jobs/JobNotes.razor, line 38 · Tom Young: "Please rename this (5)."',
      '6. Thread 6 · the whole pull request · Tom Young: "Please rename this (6)."',
    ]);
    expect(writes()).toEqual([]);
  });

  it('several people can start reviews of the same PR at once', async () => {
    const { launcher, deps } = await setUp();
    const [first, second] = await Promise.all([
      launcher.launch({ source: { kind: 'pull-request', id: 10598 }, lane: 'code-review' }),
      launcher.launch({ source: { kind: 'pull-request', id: 10598 }, lane: 'code-review' }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    // Each gets its own read-only worktree: the worktree service names them pr-10598-review and pr-10598-review-2.
    expect(deps.worktrees.create.mock.calls.map(([input]) => input.checkout)).toEqual([
      { branch: 'users/ty/71298-invoice-matching', detached: true },
      { branch: 'users/ty/71298-invoice-matching', detached: true },
    ]);
  });
});

describe('per-lane drop defaults (AL-240)', () => {
  it("starts the agent with the lane's defaults from Settings, and the Alt sheet's choices over them", async () => {
    const { launcher, deps } = await setUp({ laneDefaults: () => ({ skills: ['brainstorm'], model: 'sonnet', effort: 'xhigh' }) });
    await launcher.launch({ source: board(71335), lane: 'planning', repo: REPO });
    expect(deps.worktrees.create.mock.calls[0]![0]).toMatchObject({ skills: ['brainstorm'], model: 'sonnet', effort: 'xhigh' });

    await launcher.launch({
      source: board(71273),
      lane: 'implementing',
      repo: REPO,
      overrides: { skills: ['/cs-plan'], model: 'haiku', effort: 'low', gates: { planning: 'approval', implementing: 'approval', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' } },
    });
    expect(deps.worktrees.create.mock.calls[1]![0]).toMatchObject({
      skills: ['cs-plan'],
      model: 'haiku',
      effort: 'low',
      gates: { planning: 'approval', implementing: 'approval', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
    });
  });
});
