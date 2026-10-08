import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Linking } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { summarizeChecks, type PullRequestSnapshot, type WorkItemComment } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT, adoFixtureWorkItem } from '@agent-lanes/contracts/testing';
import { installFakeBridge } from '@/shared/testing';
import { AdoTab, type AdoTabProps } from './AdoTab';

vi.setConfig({ testTimeout: 30_000 });

const hostile = '<p>Watch <b>this</b><script>window.hacked = true</script><img src=x onerror="window.hacked = true"></p>';

const comments: WorkItemComment[] = [
  {
    id: 1,
    workItemId: 71273,
    text: '<div>Please keep <i>frmJobNotes</i> as WinForms.</div>' + hostile,
    format: 'html',
    author: 'Kyle Richards',
    createdAt: '2026-10-07T03:58:00Z',
    updatedAt: null,
    fromAgentLanes: false,
  },
  {
    id: 2,
    workItemId: 71273,
    text: 'Agent Lanes · Planning approved\n\n- explore\n- razor-writer',
    format: 'markdown',
    author: 'Kyle Richards',
    createdAt: '2026-10-07T04:02:00Z',
    updatedAt: '2026-10-07T04:03:00Z',
    fromAgentLanes: true,
  },
];

const ticket: AdoTabProps['ticket'] = {
  ado: { orgUrl: 'https://dev.azure.com/contoso', project: ADO_FIXTURE_PROJECT, workItemId: 71273 },
  pullRequest: { id: 10612, status: 'active', checks: { passed: 3, total: 4, pending: 1 } },
};

function setup(props: Partial<AdoTabProps> = {}, replies: Parameters<typeof installFakeBridge>[0] = {}) {
  const item = { ...adoFixtureWorkItem(71273), description: `<div>Cut over.</div>${hostile}` };
  const bridge = installFakeBridge({
    'ado:getWorkItem': { ok: true, data: item },
    'ado:getComments': { ok: true, data: comments },
    ...replies,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <AdoTab ticket={ticket} {...props} />
    </QueryClientProvider>,
  );
  return { bridge, view };
}

describe('AdoTab (AL-180)', () => {
  it('shows the work item fields, description and acceptance criteria', async () => {
    setup();
    const fields = await screen.findByTestId('ado-fields');
    expect(within(fields).getByText('User Story')).toBeTruthy();
    expect(within(fields).getByText('Active')).toBeTruthy();
    expect(within(fields).getByText('Sprint 42')).toBeTruthy();
    expect(within(fields).getByText(ADO_FIXTURE_PROJECT)).toBeTruthy();
    expect(screen.getByTestId('ado-description').textContent).toContain('Cut over.');
    const criteria = screen.getByTestId('ado-acceptance-criteria');
    expect(within(criteria).getByText('Grid filters work as in WinForms.')).toBeTruthy();
    expect(within(criteria).getAllByText('•')).toHaveLength(2);
  });

  it('never renders raw HTML from ADO', async () => {
    const { view } = setup();
    await screen.findByTestId('ado-fields');
    await screen.findAllByTestId('ado-comment');

    const { container } = view;
    // Nothing from ADO became an element: no script, image or bold tag, and no handler ran.
    expect(container.querySelector('script, img, iframe, b, i, style')).toBeNull();
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
    expect(container.innerHTML).not.toMatch(/onerror|window\.hacked|&lt;script/);
    expect(screen.getByTestId('ado-description').textContent).toContain('Watch this[Image]');
  });

  it('lists the comments and marks Agent Lanes write-backs', async () => {
    setup();
    const rows = await screen.findAllByTestId('ado-comment');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Please keep frmJobNotes as WinForms.');
    expect(within(rows[0]!).queryByTestId('ado-comment-agent-lanes')).toBeNull();
    expect(within(rows[1]!).getByTestId('ado-comment-agent-lanes').textContent).toBe('Agent Lanes');
    expect(within(rows[1]!).getByText('razor-writer')).toBeTruthy();
    expect(within(rows[1]!).getByText('edited')).toBeTruthy();
  });

  it('asks for comments in the work item project', async () => {
    const { bridge } = setup();
    await screen.findAllByTestId('ado-comment');
    expect(bridge.invoke).toHaveBeenCalledWith('ado:getComments', { workItemId: 71273, project: ADO_FIXTURE_PROJECT });
  });

  it('shows the linked pull request from the ticket', async () => {
    setup();
    expect((await screen.findByTestId('ado-pull-request-id')).textContent).toBe('PR !10612');
    expect(screen.getByTestId('ado-pull-request-checks').textContent).toBe('3 / 4 checks · 1 pending');
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('lists every check when the ticket keeps the pull request ref', async () => {
    const checks = summarizeChecks([
      { id: 'policy:1', kind: 'policy', name: 'Build', state: 'failed', required: true, detail: 'CS0246: JobFilterState not found', url: null },
      { id: 'status:sonar/gate', kind: 'status', name: 'sonarcloud/quality-gate', state: 'passed', required: false, detail: null, url: null },
    ]);
    const snapshot: PullRequestSnapshot = {
      pullRequest: {
        id: 10612,
        title: 'Cutover frmJobControl to Blazor',
        description: '',
        status: 'active',
        mergeStatus: 'succeeded',
        isDraft: false,
        sourceBranch: '71273-cutover-job-control',
        targetBranch: 'main',
        repository: { id: 'r', name: 'onsite-companion', projectId: 'p', projectName: ADO_FIXTURE_PROJECT },
        createdAt: '2026-10-07T05:00:00Z',
        closedAt: null,
        mergeCommitId: null,
        workItemIds: [71273],
        webUrl: 'https://dev.azure.com/contoso/OnSite/_git/onsite-companion/pullrequest/10612',
      },
      checks,
    };
    const open = vi.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setup({ pullRequestRef: { project: 'p', repository: 'r', pullRequestId: 10612 } }, { 'ado:getPullRequest': { ok: true, data: snapshot } });

    const rows = await screen.findAllByTestId('ado-check');
    expect(rows.map((row) => row.textContent)).toEqual(['FailedBuildCS0246: JobFilterState not found', 'Passedsonarcloud/quality-gate (optional)']);
    expect(screen.getByTestId('ado-pull-request-checks').textContent).toBe('1 / 2 checks');
    fireEvent.click(screen.getByRole('link', { name: 'Open the pull request in Azure DevOps' }));
    expect(open).toHaveBeenCalledWith(snapshot.pullRequest.webUrl);
    open.mockRestore();
  });

  it('says when there is no work item or pull request', () => {
    setup({ ticket: { ado: null, pullRequest: null } });
    expect(screen.getByTestId('ado-no-work-item').textContent).toBe('This ticket has no Azure DevOps work item.');
  });

  it('offers Retry when Azure DevOps cannot be reached', async () => {
    setup({}, { 'ado:getWorkItem': { ok: false, code: 'NETWORK', message: 'Azure DevOps is unreachable' } });
    expect((await screen.findByTestId('ado-error')).textContent).toContain("Couldn't load work item #71273.");
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });
});
