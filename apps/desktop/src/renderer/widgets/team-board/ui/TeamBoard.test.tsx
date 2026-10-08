import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ActivePullRequestList, TeamBoard as TeamBoardData, TeamBoardItem } from '@agent-lanes/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { fakeAdoRow, fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { resetTeamBoardSession } from '../model/session';
import { TeamBoard } from './TeamBoard';

const KR = { id: 'kr', displayName: 'Kyle Richards', uniqueName: null, initials: 'KR' };
const MD = { id: 'md', displayName: 'Mark Davies', uniqueName: null, initials: 'MD' };

function item(id: number, columnId: string, fields: Partial<TeamBoardItem> = {}): TeamBoardItem {
  const kind = ({ todo: 'to-do', doing: 'in-progress', review: 'code-review', testing: 'testing', failed: 'failed' } as const)[columnId as 'todo'];
  return {
    id,
    type: 'Bug',
    title: `Item ${id}`,
    state: 'Active',
    points: 3,
    columnId,
    column: columnId,
    columnKind: kind,
    assignee: null,
    branch: null,
    pullRequestId: null,
    webUrl: `https://dev.azure.com/x/_workitems/edit/${id}`,
    ...fields,
  };
}

const board: TeamBoardData = {
  team: { id: 'osc', name: 'OSC Developers' },
  sprint: { id: 's42', name: 'Sprint 42', path: 'OnSite\\Sprint 42' },
  columns: [
    { id: 'todo', name: 'To Do', kind: 'to-do' },
    { id: 'doing', name: 'In Progress', kind: 'in-progress' },
    { id: 'review', name: 'Code Review', kind: 'code-review' },
    { id: 'testing', name: 'Testing', kind: 'testing' },
    { id: 'failed', name: 'Failed', kind: 'failed' },
  ],
  items: [
    item(71341, 'todo', { assignee: MD }),
    item(71335, 'todo', { type: 'User Story', points: 5 }),
    item(71273, 'doing', { type: 'User Story', points: 8, assignee: KR }),
    item(71318, 'failed', { state: 'Failed UAT', assignee: KR }),
  ],
};

const SPRINT = board.sprint.path;

const prs: ActivePullRequestList = {
  team: board.team,
  pullRequests: [
    {
      id: 10598,
      title: 'Supplier invoice matching rules',
      isDraft: false,
      author: MD,
      reviewers: [],
      sourceBranch: 'feature/invoices',
      targetBranch: 'main',
      repository: { id: 'r', name: 'onsite-companion', projectId: 'p', projectName: 'OnSite' },
      createdAt: '2026-10-07T03:00:00.000Z',
      unresolvedThreads: 4,
      repoRegistered: true,
      webUrl: 'https://dev.azure.com/x/_git/r/pullrequest/10598',
    },
  ],
};

function setup(replies: Parameters<typeof installFakeBridge>[0] = {}) {
  const bridge = installFakeBridge({
    'connections:list': { ok: true, data: [fakeAdoRow()] },
    'ado:listTeams': { ok: true, data: { teams: [board.team, { id: 'qa', name: 'QA Team' }], defaultTeamId: 'osc' } },
    'ado:teamBoard': { ok: true, data: board },
    'ado:activePrs': { ok: true, data: prs },
    'ado:backlog': { ok: true, data: { team: board.team, total: 48, page: { index: 0, size: 1, count: 48 }, groups: [] } },
    ...replies,
  });
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273', stage: 'implementing' })]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TeamBoard sprintPath={SPRINT} store={store} />
    </QueryClientProvider>,
  );
  return { bridge, view, client, store };
}

beforeEach(() => resetTeamBoardSession());

describe('TeamBoard (AL-234)', () => {
  it('shows the header, the columns with counts and Active PRs as on artboard 08', async () => {
    const { bridge } = setup();
    await screen.findByTestId('team-board-columns');
    expect(screen.getByTestId('team-board-org').textContent).toBe('Azure DevOps · CompanionSystems');
    expect(screen.getByRole('button', { name: 'Team: OSC Developers · from your ADO profile' })).toBeTruthy();
    expect(screen.getByText('Your or unassigned cards · any open PR for review')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('team-board-backlog').textContent).toContain('Backlog 48'));

    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['To Do', 'In Progress', 'Code Review', 'Testing', 'Failed', 'Active PRs']);
    expect(within(screen.getByTestId('team-column-todo')).getByLabelText('2 cards')).toBeTruthy();

    const pr = screen.getByTestId('team-pr-10598');
    expect(within(pr).getByText('!10598')).toBeTruthy();
    expect(within(pr).getByText('4 comments')).toBeTruthy();

    expect(bridge.invoke).toHaveBeenCalledWith('ado:teamBoard', { sprint: 'OnSite\\Sprint 42' });
    expect(bridge.invoke).toHaveBeenCalledWith('ado:activePrs', {});
  });

  it("puts a lock with the assignee's name on others' items and an Agent tag on agent items, both in words", async () => {
    setup();
    const locked = await screen.findByTestId('team-card-71341');
    expect(within(locked).getByTestId('team-card-71341-lock').textContent).toBe('Assigned to Mark Davies');
    expect(locked.getAttribute('aria-label')).toContain('locked: Assigned to Mark Davies');

    const agent = screen.getByTestId('team-card-71273');
    expect(within(agent).getByTestId('team-card-71273-agent').textContent).toBe('Agent in Implementing');
    expect(agent.getAttribute('aria-label')).toContain('Agent in Implementing');

    // My own item: no lock.
    expect(screen.queryByTestId('team-card-71318-lock')).toBeNull();
  });

  it('filters to Me and to Unassigned, and keeps the choice for the session', async () => {
    const { view, client } = setup();
    await screen.findByTestId('team-board-columns');

    fireEvent.click(screen.getByRole('radio', { name: 'Me' }));
    await waitFor(() => expect(screen.queryByTestId('team-card-71341')).toBeNull());
    expect(screen.getByTestId('team-card-71273')).toBeTruthy();
    expect(screen.queryByTestId('team-pr-10598')).toBeNull();

    view.unmount();
    render(
      <QueryClientProvider client={client}>
        <TeamBoard sprintPath={SPRINT} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('team-board-columns');
    expect(screen.getByRole('radio', { name: 'Me' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Unassigned' }));
    await waitFor(() => expect(screen.queryByTestId('team-card-71273')).toBeNull());
    expect(screen.getByTestId('team-card-71335')).toBeTruthy();
  });

  it('switches team, reading that team on its current sprint, and keeps the team for the session', async () => {
    const { bridge, view, client } = setup();
    await screen.findByTestId('team-board-columns');

    fireEvent.click(screen.getByRole('button', { name: 'Team: OSC Developers · from your ADO profile' }));
    fireEvent.click(await screen.findByTestId('team-board-team-item-qa'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('ado:teamBoard', { team: 'qa' }));
    expect(bridge.invoke).toHaveBeenCalledWith('ado:activePrs', { team: 'qa' });

    view.unmount();
    vi.mocked(bridge.invoke).mockClear();
    render(
      <QueryClientProvider client={client}>
        <TeamBoard sprintPath={SPRINT} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('team-board-columns');
    expect(bridge.invoke).not.toHaveBeenCalledWith('ado:teamBoard', { sprint: 'OnSite\\Sprint 42' });
  });

  it("uses the agent board's sprint only on the team that sprint belongs to (the header's Team menu)", async () => {
    const bridge = installFakeBridge({
      'connections:list': { ok: true, data: [fakeAdoRow()] },
      'ado:listTeams': { ok: true, data: { teams: [board.team, { id: 'qa', name: 'QA Team' }], defaultTeamId: 'osc' } },
      'ado:teamBoard': { ok: true, data: board },
      'ado:activePrs': { ok: true, data: prs },
      'ado:backlog': { ok: true, data: { team: board.team, total: 48, page: { index: 0, size: 1, count: 48 }, groups: [] } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TeamBoard sprintPath="OnSite\QA Sprint 7" sprintTeamId="qa" />
      </QueryClientProvider>,
    );
    await screen.findByTestId('team-board-columns');
    expect(bridge.invoke).not.toHaveBeenCalledWith('ado:teamBoard', { sprint: 'OnSite\\QA Sprint 7' });

    fireEvent.click(screen.getByRole('button', { name: 'Team: OSC Developers · from your ADO profile' }));
    fireEvent.click(await screen.findByTestId('team-board-team-item-qa'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('ado:teamBoard', { team: 'qa', sprint: 'OnSite\\QA Sprint 7' }));
  });

  it('asks for a connection when no organisation is connected', async () => {
    setup({ 'connections:list': { ok: true, data: [] } });
    expect(await screen.findByTestId('team-board-not-connected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Connections' })).toBeTruthy();
  });

  it('says when the board could not be read, with Retry', async () => {
    setup({ 'ado:teamBoard': { ok: false, code: 'INTERNAL', message: 'Azure DevOps answered 500.' } });
    const error = await screen.findByTestId('team-board-error');
    expect(error.textContent).toContain('Azure DevOps answered 500.');
    expect(within(error).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('leaves Backlog off until the popout exists (AL-239)', async () => {
    setup();
    await screen.findByTestId('team-board-columns');
    expect(screen.getByTestId('team-board-backlog').getAttribute('aria-disabled')).toBe('true');
  });
});
