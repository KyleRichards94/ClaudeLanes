import { defaultSettings, type Settings, type WorktreePreview, type WorktreePreviewRequest } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installFakeSettings } from '@/shared/testing';
import type { NewTicketRequest } from '../model/form';
import { NewTicketModal } from './NewTicketModal';

vi.setConfig({ testTimeout: 15_000 });

const REPO = 'C:\\src\\onsite-companion';

function settings(): Settings {
  return {
    ...defaultSettings(),
    repos: [
      {
        path: REPO,
        name: 'onsite-companion',
        baseBranch: 'main',
        worktreeRoot: 'C:\\src\\.agent-lanes',
        buildCommand: null,
        runCommand: null,
        maxConcurrentAgents: 3,
      },
    ],
  };
}

/** Main's preview, faked: `nt-20261007-<first word>`, and two names it refuses the way the worktree service does. */
function fakePreview({ repo, subject, branch }: WorktreePreviewRequest): WorktreePreview {
  const generatedBranch =
    subject?.kind === 'no-ticket'
      ? `nt-20261007-${subject.description.trim().split(/\s+/)[0]?.toLowerCase() || 'untitled'}`
      : subject
        ? `${subject.workItemId}-grid`
        : null;
  let problem: WorktreePreview['problem'] = null;
  if (branch !== null && branch !== generatedBranch) {
    if (/\s/.test(branch)) problem = { reason: 'invalid-branch', message: "Branch names can't contain spaces." };
    else if (branch === 'main') problem = { reason: 'branch-taken', message: 'A branch named "main" already exists.' };
    else if (branch === '') problem = { reason: 'invalid-branch', message: 'Enter a branch name.' };
  }
  return {
    repo,
    repoName: 'onsite-companion',
    baseBranch: 'main',
    generatedBranch,
    branch: branch ?? generatedBranch,
    worktreePath: generatedBranch ? `C:\\src\\.agent-lanes\\${generatedBranch}` : null,
    problem,
  };
}

async function renderModal() {
  const fake = installFakeSettings(settings());
  const base = fake.bridge.invoke;
  const previews: WorktreePreviewRequest[] = [];
  fake.bridge.invoke = vi.fn(async (channel: string, payload?: unknown) => {
    if (channel !== 'git:previewWorktree') return base(channel as never, payload as never);
    previews.push(payload as WorktreePreviewRequest);
    return { ok: true, data: fakePreview(payload as WorktreePreviewRequest) };
  }) as typeof base;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await client.prefetchQuery({ queryKey: ['settings'], queryFn: () => settings() });
  const onLaunch = vi.fn<(request: NewTicketRequest) => void>();
  render(
    <QueryClientProvider client={client}>
      <NewTicketModal visible onClose={vi.fn()} onLaunch={onLaunch} />
    </QueryClientProvider>,
  );
  await screen.findByRole('dialog', { name: 'New agent ticket' });
  return { onLaunch, previews };
}

const worktreeField = () => screen.getByRole('textbox', { name: 'Worktree' }) as HTMLInputElement;

async function describeJob(text: string) {
  fireEvent.click(screen.getByRole('radio', { name: 'No ticket' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'What should the agent do?' }), { target: { value: text } });
  await waitFor(() => expect(worktreeField().value).toBe(`nt-20261007-${text.split(' ')[0]!.toLowerCase()}`));
}

describe('NewTicketModal workspace and stage gates', () => {
  it('shows the repo, base and the generated worktree name', async () => {
    const { previews } = await renderModal();
    expect(screen.getByTestId('workspace-repo').textContent).toBe('onsite-companion');
    expect(screen.getByTestId('workspace-base').textContent).toBe('main');
    // No work item yet: nothing to name the worktree after.
    expect(worktreeField().value).toBe('');
    expect(worktreeField().placeholder).toBe('Named after the work item');

    await describeJob('Fix the supplier login');
    expect(screen.getByText('Created in C:\\src\\.agent-lanes\\nt-20261007-fix')).toBeTruthy();
    expect(previews.at(-1)).toEqual({ repo: REPO, subject: { kind: 'no-ticket', description: 'Fix the supplier login' }, branch: null });
  });

  it('blocks Launch with the reason while the edited worktree name is invalid', async () => {
    const { onLaunch } = await renderModal();
    await describeJob('Fix the supplier login');

    fireEvent.change(worktreeField(), { target: { value: 'fix login' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));

    const alert = await screen.findByTestId('workspace-error');
    expect(alert.textContent).toBe("Branch names can't contain spaces.");
    expect(alert.getAttribute('role')).toBe('alert');
    expect(worktreeField().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(worktreeField()));
    expect(onLaunch).not.toHaveBeenCalled();

    // A name another branch has is refused too, with its own reason.
    fireEvent.change(worktreeField(), { target: { value: 'main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    expect((await screen.findByTestId('workspace-error')).textContent).toBe('A branch named "main" already exists.');
    expect(onLaunch).not.toHaveBeenCalled();

    // Fixed: the reason goes and Launch passes the edited name and repo on.
    fireEvent.change(worktreeField(), { target: { value: 'fix-supplier-login' } });
    await waitFor(() => expect(screen.queryByTestId('workspace-error')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(onLaunch.mock.calls[0]![0]).toMatchObject({ worktreeName: 'fix-supplier-login', repo: REPO });
  });

  it('shows the reason as the user types, before Launch', async () => {
    await renderModal();
    await describeJob('Fix the supplier login');
    fireEvent.change(worktreeField(), { target: { value: '' } });
    expect((await screen.findByTestId('workspace-error')).textContent).toBe('Enter a branch name.');
  });

  it('starts with Planning and Create PR needing approval, and passes changed gates to Launch', async () => {
    const { onLaunch } = await renderModal();
    const gate = (name: RegExp) => screen.getByRole('switch', { name });
    expect(gate(/^Planning/).getAttribute('aria-checked')).toBe('true');
    expect(gate(/^Implementing/).getAttribute('aria-checked')).toBe('false');
    expect(gate(/^Code review/).getAttribute('aria-checked')).toBe('false');
    expect(gate(/^QA/).getAttribute('aria-checked')).toBe('false');
    expect(gate(/^Create PR/).getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByText('Needs approval')).toHaveLength(2);
    expect(screen.getAllByText('Auto')).toHaveLength(3);

    fireEvent.click(gate(/^QA/));
    fireEvent.click(gate(/^Planning/));
    expect(gate(/^QA/).getAttribute('aria-checked')).toBe('true');

    await describeJob('Fix the supplier login');
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(onLaunch.mock.calls[0]![0]).toMatchObject({
      gates: { planning: 'auto', implementing: 'auto', 'code-review': 'auto', qa: 'approval', 'create-pr': 'approval' },
      worktreeName: null,
      repo: REPO,
    });
  });
});
