import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTickets } from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { defaultCompanionPrompt } from '../model/draft';
import { AddAgentModal } from './AddAgentModal';

function renderModal(onAdded = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddAgentModal ticketId="71273" skills={['code-review']} visible onClose={onClose} onAdded={onAdded} />
    </QueryClientProvider>,
  );
  return { onAdded, onClose };
}

describe('AddAgentModal (AL-266)', () => {
  beforeEach(() => {
    agentTickets.load([fakeTicketRecord({ id: '71273', stage: 'implementing' })]);
  });

  it('starts as a Sonnet reviewer with the review task, and sends the role, name, model, effort, skills and task', async () => {
    const bridge = installFakeBridge({
      'agent:addAgent': { ok: true, data: { companionId: '71273-reviewer-eyes', status: { ticketId: '71273-reviewer-eyes', state: 'running', sessionId: null, message: null } } },
    });
    const { onAdded, onClose } = renderModal();

    expect(screen.getByRole('dialog', { name: 'Add an agent' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Reviewer' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Sonnet' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByTestId('add-agent-prompt') as HTMLTextAreaElement).value).toBe(defaultCompanionPrompt('reviewer'));
    expect(screen.getByTestId('add-agent-role-help').textContent).toContain('read-only');

    fireEvent.change(screen.getByTestId('add-agent-name'), { target: { value: 'Eyes' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Opus' }));
    fireEvent.click(screen.getByTestId('add-agent-confirm'));

    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:addAgent', { ticketId: '71273', role: 'reviewer', name: 'Eyes', model: 'opus', effort: 'high', skills: ['code-review'], prompt: defaultCompanionPrompt('reviewer') }),
    );
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('71273-reviewer-eyes'));
    expect(onClose).toHaveBeenCalled();
  });

  it('switching to Helper swaps in its defaults, keeps a name the user typed, and shows why adding failed', async () => {
    installFakeBridge({ 'agent:addAgent': { ok: false, code: 'VALIDATION', message: 'There is already a helper called "Docs" on this ticket. Pick another name.' } });
    renderModal();
    fireEvent.change(screen.getByTestId('add-agent-name'), { target: { value: 'Docs' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Helper' }));
    expect((screen.getByTestId('add-agent-name') as HTMLInputElement).value).toBe('Docs');
    expect((screen.getByTestId('add-agent-prompt') as HTMLTextAreaElement).value).toBe(defaultCompanionPrompt('helper'));
    expect(screen.getByTestId('add-agent-role-help').textContent).toContain('sub-branch');
    fireEvent.change(screen.getByTestId('add-agent-prompt'), { target: { value: 'Write the release notes.' } });
    fireEvent.click(screen.getByTestId('add-agent-confirm'));
    expect((await screen.findByRole('alert')).textContent).toContain('already a helper called "Docs"');
  });

  it('refuses an empty name or task before asking the main process', () => {
    const bridge = installFakeBridge({});
    renderModal();
    fireEvent.change(screen.getByTestId('add-agent-prompt'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('add-agent-confirm'));
    expect(screen.getByRole('alert').textContent).toBe('Say what the agent should do.');
    expect(bridge.invoke).not.toHaveBeenCalledWith('agent:addAgent', expect.anything());
  });
});
