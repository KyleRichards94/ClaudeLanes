import { defaultSettings, type Settings, type ListSkillsResponse } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installFakeSettings } from '@/shared/testing';
import type { NewTicketRequest } from '../model/form';
import { NewTicketModal } from './NewTicketModal';

vi.setConfig({ testTimeout: 15_000 });

const REPO = 'C:\\src\\onsite-companion';

function settings(): Settings {
  const base = defaultSettings();
  return {
    ...base,
    defaults: { ...base.defaults, skills: ['code-review'] },
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

const SKILLS: ListSkillsResponse = {
  repo: REPO,
  skills: [
    { name: 'code-review', description: 'Review the diff', argumentHint: '' },
    { name: 'osc-blazor-cutover-invoke', description: 'Cut a form over', argumentHint: '' },
  ],
  loadedAt: 1,
};

describe('NewTicketModal skills (AL-162)', () => {
  it("shows the repo's skills as chips, starts from the default ones and launches with the selection", async () => {
    const fake = installFakeSettings(settings(), {
      'skills:list': { ok: true, data: SKILLS },
      'git:previewWorktree': { ok: true, data: { repo: REPO, repoName: 'onsite-companion', baseBranch: 'main', generatedBranch: null, branch: null, worktreePath: null, problem: null } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.prefetchQuery({ queryKey: ['settings'], queryFn: () => settings() });
    const onLaunch = vi.fn<(request: NewTicketRequest) => void>();
    render(
      <QueryClientProvider client={client}>
        <NewTicketModal visible onClose={vi.fn()} onLaunch={onLaunch} />
      </QueryClientProvider>,
    );

    const cutover = await screen.findByRole('checkbox', { name: '/osc-blazor-cutover-invoke' });
    const review = screen.getByRole('checkbox', { name: '/code-review' });
    expect(fake.bridge.invoke).toHaveBeenCalledWith('skills:list', { repo: REPO });
    expect(review.getAttribute('aria-checked')).toBe('true');
    expect(cutover.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(cutover);
    fireEvent.click(review);
    expect(screen.getByRole('checkbox', { name: '/osc-blazor-cutover-invoke' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '/code-review' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('radio', { name: 'No ticket' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What should the agent do?' }), { target: { value: 'Cut frmJobControl over' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));

    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(onLaunch.mock.calls[0]![0].skills).toEqual(['osc-blazor-cutover-invoke']);
  });
});
