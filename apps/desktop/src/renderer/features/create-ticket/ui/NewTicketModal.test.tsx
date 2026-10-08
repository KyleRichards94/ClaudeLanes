import { SDK_MODEL_IDS, defaultSettings, type Settings } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoFixture } from '@agent-lanes/contracts/testing';
import { agentTickets } from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeSettings } from '@/shared/testing';
import type { NewTicketRequest } from '../model/form';
import { NewTicketModal } from './NewTicketModal';

vi.setConfig({ testTimeout: 15_000 });

function settings(): Settings {
  const base = defaultSettings();
  return { ...base, defaults: { ...base.defaults, model: 'sonnet', effort: 'high', skills: ['code-review'] } };
}

async function renderModal(
  onLaunch: (request: NewTicketRequest) => void | Promise<void> = vi.fn(),
  replies: Parameters<typeof installFakeSettings>[1] = {},
) {
  installFakeSettings(settings(), replies);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The app has read the settings before anyone opens the modal.
  await client.prefetchQuery({ queryKey: ['settings'], queryFn: () => settings() });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NewTicketModal visible onClose={onClose} onLaunch={onLaunch} />
    </QueryClientProvider>,
  );
  await screen.findByRole('dialog', { name: 'New agent ticket' });
  return { onClose, onLaunch };
}

/** Presses Tab until `matches` holds for the focused element (at most 30 times). */
async function tabUntil(user: UserEvent, matches: (element: Element) => boolean, what: string) {
  for (let i = 0; i < 30; i += 1) {
    if (document.activeElement && matches(document.activeElement)) return document.activeElement as HTMLElement;
    await user.tab();
  }
  throw new Error(`Tab never reached ${what}`);
}

const named = (role: string, name: string | RegExp) => (element: Element) =>
  element === screen.queryByRole(role, { name });

describe('NewTicketModal', () => {
  it('starts from the saved defaults and says what Launch will do', async () => {
    await renderModal();
    expect(screen.getByRole('radio', { name: 'Sonnet' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'High' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Sprint' }).getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText('Launch starts a headless Claude Code session in its own worktree via the MCP bridge. No work item picked yet. Sonnet · High.'),
    ).toBeTruthy();
    expect(screen.getByTestId('new-ticket-left')).toBeTruthy();
    expect(screen.getByTestId('new-ticket-right')).toBeTruthy();
  });

  it('goes from open to launch with the keyboard only', async () => {
    const user = userEvent.setup();
    const { onLaunch, onClose } = await renderModal(vi.fn(async () => undefined));

    // Work item: Tab into the Sprint / Search / No ticket control, then arrows to "No ticket".
    await tabUntil(user, named('radio', 'Sprint'), 'the work item control');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'No ticket' }).getAttribute('aria-checked')).toBe('true');

    // Job description.
    await tabUntil(user, named('textbox', 'What should the agent do?'), 'the job description');
    await user.keyboard('Fix the login redirect loop');

    // Effort: arrows move the selection.
    await tabUntil(user, (element) => element.getAttribute('role') === 'radio' && element.textContent === 'High', 'the effort control');
    await user.keyboard('{ArrowRight}');

    await tabUntil(user, named('button', 'Launch agent'), 'Launch agent');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(onLaunch).toHaveBeenCalledWith({
      workItem: null,
      description: 'Fix the login redirect loop',
      skills: ['code-review'],
      model: 'sonnet',
      effort: 'xhigh',
      gates: settings().defaults.stageGates,
      worktreeName: null,
      // No repo registered in this profile.
      repo: null,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows why Launch is blocked and moves focus to the description', async () => {
    const { onLaunch } = await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    expect(screen.getByRole('alert').textContent).toBe('Pick a work item, or choose No ticket.');

    fireEvent.click(screen.getByRole('radio', { name: 'No ticket' }));
    expect(screen.queryByText('Pick a work item, or choose No ticket.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    const field = screen.getByRole('textbox', { name: 'What should the agent do?' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Describe the job: a ticket without a work item starts from this.')).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('keeps the form open with the reason when the launch fails', async () => {
    const { onClose } = await renderModal(vi.fn(async () => Promise.reject(new Error('The worktree folder already exists.'))));
    fireEvent.click(screen.getByRole('radio', { name: 'No ticket' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What should the agent do?' }), { target: { value: 'Fix it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The worktree folder already exists.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts the session with the model card the user picked (Decision D10 ids)', async () => {
    const onLaunch = vi.fn<(request: NewTicketRequest) => void>();
    await renderModal(onLaunch);
    expect(screen.getByText('Changeable any time')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Opus' }));
    fireEvent.click(screen.getByRole('radio', { name: 'XHigh' }));
    expect(screen.getByText(/Opus · XHigh\.$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'No ticket' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What should the agent do?' }), { target: { value: 'Fix it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));

    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    const request = onLaunch.mock.calls[0]![0];
    expect(request).toMatchObject({ model: 'opus', effort: 'xhigh' });
    expect(SDK_MODEL_IDS[request.model]).toBe('claude-opus-5-5');
  });

  it('closes on Cancel without launching', async () => {
    const { onClose, onLaunch } = await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });
});

describe('NewTicketModal work item picker (AL-161)', () => {
  const fixture = adoFixture();
  const sprintItems = fixture.workItems.slice(0, 4);
  const adoReplies = {
    'ado:listSprints': { ok: true, data: fixture.sprints },
    'ado:listWorkItems': { ok: true, data: sprintItems },
    'ado:searchWorkItems': { ok: true, data: fixture.workItems.filter((item) => item.id === 71400) },
  };

  afterEach(() => agentTickets.load([]));

  it('lists the sprint as radio rows and launches with the picked work item', async () => {
    const onLaunch = vi.fn(async () => undefined);
    await renderModal(onLaunch, adoReplies);

    expect(await screen.findByRole('radio', { name: 'Sprint 42' })).toBeTruthy();
    const row = await screen.findByRole('radio', { name: '#71273 Cutover frmJobControl to Blazor, Story · Active' });
    expect(screen.getByRole('radio', { name: '#71330 Asset register paging slow above 5k rows, Bug · New' })).toBeTruthy();
    expect(screen.getByText('Optional')).toBeTruthy();

    fireEvent.click(row);
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Linked to #71273\./)).toBeTruthy();

    // Typing filters the sprint's rows straight away.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by ID or title' }), { target: { value: 'roster' } });
    expect(screen.queryByRole('radio', { name: /^#71273/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /^#71341 Roster view/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledTimes(1));
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ workItem: { id: 71273, title: 'Cutover frmJobControl to Blazor', type: 'User Story', state: 'Active' } }));
  });

  it('searches Azure DevOps once typing pauses', async () => {
    await renderModal(vi.fn(), adoReplies);
    fireEvent.click(await screen.findByRole('radio', { name: 'Search' }));
    expect(screen.getByText('Type a work item id or part of its title to search Azure DevOps.')).toBeTruthy();

    const field = screen.getByRole('searchbox', { name: 'Search by ID or title' });
    fireEvent.change(field, { target: { value: 'job' } });
    fireEvent.change(field, { target: { value: 'job cost' } });
    expect(await screen.findByRole('radio', { name: '#71400 Job costing tab, Story · New' })).toBeTruthy();
    const searches = vi.mocked(window.agentLanes.invoke).mock.calls.filter(([channel]) => channel === 'ado:searchWorkItems');
    expect(searches).toEqual([['ado:searchWorkItems', { query: 'job cost' }]]);
  });

  it('shows the lane instead of a radio for a work item an agent is already on', async () => {
    agentTickets.load([fakeTicketRecord({ id: '71273', stage: 'implementing' })]);
    await renderModal(vi.fn(), adoReplies);

    await screen.findByRole('radio', { name: /^#71330/ });
    expect(screen.queryByRole('radio', { name: /^#71273/ })).toBeNull();
    expect(screen.getByLabelText('#71273 Cutover frmJobControl to Blazor, Story · Active, already running in Implementing')).toBeTruthy();
    expect(screen.getByTestId('work-item-71273-lane').textContent).toBe('Implementing');
  });

  it('hides the Azure DevOps list and search for No ticket', async () => {
    await renderModal(vi.fn(), adoReplies);
    await screen.findByRole('radio', { name: /^#71273/ });
    fireEvent.click(screen.getByRole('radio', { name: 'No ticket' }));

    expect(screen.queryByTestId('work-item-picker')).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search by ID or title' })).toBeNull();
    expect(screen.getByTestId('no-ticket-note').textContent).toContain('nt-');
    expect(screen.getByText(/No work item linked\./)).toBeTruthy();
  });
});
