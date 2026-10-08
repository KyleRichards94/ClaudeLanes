import { err, ok, type AgentSessionStatus, type LaunchTicketRequest, type Result, type TicketRecord, type WorkItem } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import type { Services } from '../services';
import type { CreateTicketWorktreeInput } from '../worktrees';
import { createTicketsHandlers } from './handlers';
import { createTicketLauncher, defaultWorkItemJob, type TicketLauncherOptions } from './launch';

const ORG = 'https://dev.azure.com/contoso';

function record(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    version: 1,
    id: '71273',
    title: 'Cutover frmJobControl to Blazor',
    ado: { orgUrl: ORG, project: 'OnSite Companion', workItemId: 71273 },
    repo: 'C:\\src\\onsite',
    baseBranch: 'main',
    branch: '71273-cutover-frmjobcontrol-to',
    worktreePath: 'C:\\src\\.agent-lanes\\71273',
    subBranches: [],
    stage: 'queued',
    stageHistory: [{ stage: 'queued', at: 1 }],
    gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
    model: 'opus',
    effort: 'xhigh',
    skills: ['code-review'],
    sessionId: null,
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const workItem: WorkItem = {
  id: 71273,
  project: 'OnSite Companion',
  type: 'User Story',
  title: 'Cutover frmJobControl to Blazor',
  state: 'Active',
  stateCategory: 'in-progress',
  assignedTo: null,
  iterationPath: 'OnSite Companion\\Sprint 42',
  description: '<div>Cut frmJobControl over.</div>',
  acceptanceCriteria: '<ul><li>Grid filters work.</li></ul>',
  webUrl: `${ORG}/OnSite%20Companion/_workitems/edit/71273`,
};

function request(overrides: Partial<LaunchTicketRequest> = {}): LaunchTicketRequest {
  return {
    repo: 'C:\\src\\onsite',
    workItem: { id: 71273, title: 'Cutover frmJobControl to Blazor' },
    description: '',
    skills: ['code-review'],
    model: 'opus',
    effort: 'xhigh',
    gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
    worktreeName: null,
    ...overrides,
  };
}

const running = (ticketId: string): AgentSessionStatus => ({ ticketId, state: 'running', sessionId: null, message: null });

function setUp(options: { start?: Result<AgentSessionStatus>; create?: Result<{ record: TicketRecord }>; read?: Result<WorkItem> } = {}) {
  const saved = new Map<string, TicketRecord>();
  const created = options.create ?? ok({ record: record() });
  const deps = {
    ado: {
      getWorkItem: vi.fn(async () => options.read ?? ok(workItem)),
      clientFor: vi.fn(async () => ok({ orgUrl: ORG })),
    },
    worktrees: {
      create: vi.fn(async (input: CreateTicketWorktreeInput) => {
        void input;
        if (created.ok) saved.set(created.data.record.id, created.data.record);
        return created.ok ? ok({ record: created.data.record, start: { ref: 'origin/main', commit: 'abc', fetchError: null } }) : created;
      }),
      discard: vi.fn(async (ticketId: string) => {
        saved.delete(ticketId);
        return ok({ complete: true, leftovers: [] });
      }),
    },
    launches: {
      launch: vi.fn(async ({ ticketId }: { ticketId: string }) => {
        const result = options.start ?? ok(running(ticketId));
        // As the stage server does when a session starts (AL-103).
        const current = saved.get(ticketId);
        if (result.ok && result.data.state !== 'queued' && current) saved.set(ticketId, { ...current, stage: 'planning', stageHistory: [...current.stageHistory, { stage: 'planning', at: 2 }] });
        return result;
      }),
    },
    tickets: { get: vi.fn(async (ticketId: string) => saved.get(ticketId)) },
  };
  const launcher = createTicketLauncher(deps as unknown as TicketLauncherOptions);
  return { deps, launcher, saved };
}

describe('ticket launch (AL-165)', () => {
  it('reads the work item, creates the worktree in Queued, starts the session and returns the card in Planning', async () => {
    const { deps, launcher } = setUp();
    const result = await launcher.launch(request({ worktreeName: '71273-job-control' }));

    expect(result).toMatchObject({ ok: true, data: { record: { id: '71273', stage: 'planning' }, status: { state: 'running' } } });
    expect(deps.ado.getWorkItem).toHaveBeenCalledWith({ id: 71273 });
    expect(deps.worktrees.create).toHaveBeenCalledWith({
      repo: 'C:\\src\\onsite',
      subject: { kind: 'work-item', ado: { orgUrl: ORG, project: 'OnSite Companion', workItemId: 71273 }, title: 'Cutover frmJobControl to Blazor' },
      branch: '71273-job-control',
      model: 'opus',
      effort: 'xhigh',
      gates: request().gates,
      skills: ['code-review'],
      stage: 'queued',
    });
    // The first turn gets the item's description and acceptance criteria; an empty job gets the default.
    expect(deps.launches.launch).toHaveBeenCalledWith({
      ticketId: '71273',
      jobDescription: defaultWorkItemJob(71273),
      workItem: {
        id: 71273,
        title: 'Cutover frmJobControl to Blazor',
        type: 'User Story',
        state: 'Active',
        description: '<div>Cut frmJobControl over.</div>\n<p>Acceptance criteria:</p><ul><li>Grid filters work.</li></ul>',
      },
    });
    expect(deps.worktrees.discard).not.toHaveBeenCalled();
  });

  it('launches a "No ticket" ticket from its description without reading Azure DevOps', async () => {
    const { deps, launcher } = setUp({ create: ok({ record: record({ id: 'nt-20261008-fix-login', ado: null }) }) });
    const result = await launcher.launch(request({ workItem: null, description: '  Fix the supplier portal login  ' }));

    expect(result.ok).toBe(true);
    expect(deps.ado.getWorkItem).not.toHaveBeenCalled();
    expect(deps.worktrees.create.mock.calls[0]?.[0].subject).toEqual({ kind: 'no-ticket', description: '  Fix the supplier portal login  ' });
    expect(deps.launches.launch).toHaveBeenCalledWith({ ticketId: 'nt-20261008-fix-login', jobDescription: 'Fix the supplier portal login', workItem: null });
  });

  it('leaves a queued ticket in Queued', async () => {
    const queued: AgentSessionStatus = { ticketId: '71273', state: 'queued', sessionId: null, message: 'Waiting for a free slot' };
    const { launcher } = setUp({ start: ok(queued) });
    await expect(launcher.launch(request())).resolves.toMatchObject({ ok: true, data: { record: { stage: 'queued' }, status: queued } });
  });

  it('rolls the worktree, branch and record back when the session cannot start, and says why', async () => {
    const { deps, launcher, saved } = setUp({ start: err('VALIDATION', 'Connect Claude in Connections before starting an agent.', { reason: 'claude-not-connected' }) });
    const result = await launcher.launch(request());

    expect(result).toEqual({
      ok: false,
      code: 'VALIDATION',
      message: 'Connect Claude in Connections before starting an agent.',
      details: { reason: 'claude-not-connected', ticketId: '71273', rollback: { complete: true, leftovers: [] } },
    });
    expect(deps.worktrees.discard).toHaveBeenCalledWith('71273');
    expect(saved.size).toBe(0);
  });

  it('creates nothing when the worktree or the work item read fails', async () => {
    const refused = setUp({ create: err('VALIDATION', 'A branch named "main" already exists.', { reason: 'branch-taken' }) });
    await expect(refused.launcher.launch(request({ worktreeName: 'main' }))).resolves.toMatchObject({ ok: false, details: { reason: 'branch-taken' } });
    expect(refused.deps.launches.launch).not.toHaveBeenCalled();

    const offline = setUp({ read: err('ADO_UNAUTHORIZED', 'No Azure DevOps organisation is connected.', { reason: 'not-connected' }) });
    await expect(offline.launcher.launch(request())).resolves.toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(offline.deps.worktrees.create).not.toHaveBeenCalled();
  });

  it('is served on tickets:launch, which checks the request against its contract', async () => {
    const { launcher } = setUp();
    const handlers = createTicketsHandlers({ ...({} as Pick<Services, 'tickets' | 'archive' | 'ticketArchive' | 'reconcile'>), ticketLauncher: launcher });
    await expect(handleInvoke('tickets:launch', request(), handlers['tickets:launch'])).resolves.toMatchObject({ ok: true, data: { record: { id: '71273' } } });
    await expect(handleInvoke('tickets:launch', { ...request(), pat: 'x' }, handlers['tickets:launch'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(handleInvoke('tickets:launch', request({ worktreeName: '' }), handlers['tickets:launch'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
