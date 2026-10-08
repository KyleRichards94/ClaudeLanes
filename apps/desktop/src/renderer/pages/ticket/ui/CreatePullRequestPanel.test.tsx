import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { pullRequestRef, type InvokeChannel, type PullRequestDraft, type TicketPullRequest, type TicketPullRequestState } from '@agent-lanes/contracts';
import { adoFixture } from '@agent-lanes/contracts/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTickets, ticketFromRecord } from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { CreatePullRequestPanel } from './CreatePullRequestPanel';

vi.setConfig({ testTimeout: 15_000 });

const DRAFT: PullRequestDraft = {
  title: 'Cutover frmJobControl to Blazor',
  description: 'Cut over the job control screen.\n\nOpened by Agent Lanes from ticket 71273.',
  sourceBranch: '71273-cutover-frmjobcontrol-to',
  targetBranch: 'main',
  workItemId: 71273,
  repository: 'OnSite Companion / onsite-companion',
  blocked: null,
};

const snapshot = adoFixture().pullRequests[0]!;
const SAVED: TicketPullRequest = {
  ref: pullRequestRef(snapshot.pullRequest),
  org: 'ado:contoso',
  id: snapshot.pullRequest.id,
  webUrl: snapshot.pullRequest.webUrl,
  status: 'active',
  openedAt: 5_000,
  closedAt: null,
};
const STATE: TicketPullRequestState = { pullRequest: SAVED, snapshot };

let bridge: FakeBridge;

function reply(replies: Partial<Record<InvokeChannel, unknown>>) {
  vi.mocked(bridge.invoke).mockImplementation(async (channel: InvokeChannel) => replies[channel] ?? { ok: false, code: 'INTERNAL', message: 'no fake reply' });
}

function renderPanel(saved: TicketPullRequest | null = null) {
  const record = fakeTicketRecord({ stage: 'create-pr', pullRequest: saved });
  agentTickets.upsert(record);
  const ticket = agentTickets.getState().byId.get('71273') ?? ticketFromRecord(record);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreatePullRequestPanel ticket={ticket} saved={saved} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  bridge = installFakeBridge();
  agentTickets.remove('71273');
});

describe('Create PR panel (AL-181)', () => {
  it('starts from the drafted title and description, lets the user edit them, and creates the PR', async () => {
    reply({ 'pr:draft': { ok: true, data: DRAFT }, 'pr:create': { ok: true, data: { ...STATE, created: true } }, 'pr:get': { ok: true, data: { state: STATE } } });
    renderPanel();

    const title = (await screen.findByTestId('pull-request-title')) as HTMLInputElement;
    expect(title.value).toBe(DRAFT.title);
    expect((screen.getByTestId('pull-request-description') as HTMLTextAreaElement).value).toBe(DRAFT.description);
    expect(screen.getByTestId('pull-request-target').textContent).toBe('71273-cutover-frmjobcontrol-to → main · OnSite Companion / onsite-companion · Links work item #71273');

    fireEvent.change(title, { target: { value: 'Cutover frmJobControl to Blazor (JobControl.razor)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create pull request' }));

    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('pr:create', { ticketId: '71273', title: 'Cutover frmJobControl to Blazor (JobControl.razor)', description: DRAFT.description }),
    );
    // The card shows the PR at once, with its checks.
    await waitFor(() => expect(agentTickets.getState().byId.get('71273')?.pullRequest).toEqual({ id: SAVED.id, status: 'active', checks: { passed: snapshot.checks.passed, total: snapshot.checks.total, pending: snapshot.checks.pending } }));
  });

  it('explains why a PR cannot be created yet and keeps the button disabled', async () => {
    reply({ 'pr:draft': { ok: true, data: { ...DRAFT, blocked: "The repo's origin is not an Azure Repos remote." } } });
    renderPanel();
    expect((await screen.findByTestId('pull-request-blocked')).textContent).toContain('Azure Repos');
    expect(screen.getByRole('button', { name: 'Create pull request' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a failed create without losing what was typed', async () => {
    reply({ 'pr:draft': { ok: true, data: DRAFT }, 'pr:create': { ok: false, code: 'INTERNAL', message: 'Pushing the branch failed.' } });
    renderPanel();
    const title = (await screen.findByTestId('pull-request-title')) as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'My title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create pull request' }));
    expect((await screen.findByTestId('pull-request-error')).textContent).toBe('Pushing the branch failed.');
    expect(title.value).toBe('My title');
  });

  it('shows the open PR with its checks and a link to Azure DevOps', async () => {
    reply({ 'pr:get': { ok: true, data: { state: STATE } } });
    renderPanel(SAVED);
    expect(screen.getByTestId('pull-request-id').textContent).toBe(`PR !${SAVED.id}`);
    await waitFor(() => expect(screen.getByTestId('pull-request-checks').textContent).toBe(`${snapshot.checks.passed} / ${snapshot.checks.total} checks`));
    expect(screen.getByTestId('pull-request-status').textContent).toBe('Open');
    expect(screen.getAllByRole('listitem')).toHaveLength(snapshot.checks.checks.length);
    expect(screen.getByRole('button', { name: 'Open in Azure DevOps' })).toBeTruthy();
  });

  it('says the ticket moved to Done once the PR is merged', async () => {
    const merged: TicketPullRequestState = {
      pullRequest: { ...SAVED, status: 'completed', closedAt: 9_000 },
      snapshot: { ...snapshot, pullRequest: { ...snapshot.pullRequest, status: 'completed' } },
    };
    reply({ 'pr:get': { ok: true, data: { state: merged } } });
    renderPanel(SAVED);
    await waitFor(() => expect(screen.getByTestId('pull-request-status').textContent).toBe('Merged'));
    expect(screen.getByText('The PR was merged, so the ticket moved to Done.')).toBeTruthy();
  });
});
