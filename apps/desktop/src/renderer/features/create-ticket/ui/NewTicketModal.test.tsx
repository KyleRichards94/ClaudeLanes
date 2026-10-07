import { defaultSettings, type Settings } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { installFakeSettings } from '@/shared/testing';
import type { NewTicketRequest } from '../model/form';
import { NewTicketModal } from './NewTicketModal';

vi.setConfig({ testTimeout: 15_000 });

function settings(): Settings {
  const base = defaultSettings();
  return { ...base, defaults: { ...base.defaults, model: 'sonnet', effort: 'high', skills: ['code-review'] } };
}

async function renderModal(onLaunch: (request: NewTicketRequest) => void | Promise<void> = vi.fn()) {
  installFakeSettings(settings());
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

  it('closes on Cancel without launching', async () => {
    const { onClose, onLaunch } = await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });
});
