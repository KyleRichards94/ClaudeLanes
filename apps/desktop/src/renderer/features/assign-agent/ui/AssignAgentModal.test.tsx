import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTickets } from '@/entities/agent-ticket';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { defaultStage, parseSkillNames } from '../model/draft';
import { AssignAgentModal } from './AssignAgentModal';

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssignAgentModal ticketId="71273" skills={['code-review']} visible onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('AssignAgentModal (AL-263)', () => {
  beforeEach(() => {
    agentTickets.load([fakeTicketRecord({ id: '71273', stage: 'implementing', model: 'opus', effort: 'xhigh' })]);
  });

  it('starts from the ticket, hands over by default, and sends the picked model, effort, skills, stage and mode', async () => {
    const bridge = installFakeBridge({
      'agent:assign': { ok: true, data: { status: { ticketId: '71273', state: 'running', sessionId: 'session-b', message: null }, previousSessionId: 'session-a' } },
    });
    const onClose = renderModal();

    expect(screen.getByRole('dialog', { name: 'Assign a new agent' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Opus' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Implementing' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Hand over' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('assign-agent-skills-input').getAttribute('value') ?? (screen.getByTestId('assign-agent-skills-input') as HTMLInputElement).value).toBe('/code-review');

    fireEvent.click(screen.getByRole('radio', { name: 'Sonnet' }));
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Code review' }));
    fireEvent.change(screen.getByTestId('assign-agent-skills-input'), { target: { value: '/code-review, commit' } });
    fireEvent.click(screen.getByTestId('assign-agent-confirm'));

    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:assign', { ticketId: '71273', model: 'sonnet', effort: 'high', skills: ['code-review', 'commit'], stage: 'code-review', mode: 'hand-over' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('explains Start fresh, and shows why an assignment failed', async () => {
    installFakeBridge({ 'agent:assign': { ok: false, code: 'VALIDATION', message: 'Connect Claude in Connections before starting an agent.' } });
    renderModal();
    fireEvent.click(screen.getByRole('radio', { name: 'Start fresh' }));
    expect(screen.getByTestId('assign-agent-mode-help').textContent).toContain('original job again');
    fireEvent.click(screen.getByTestId('assign-agent-confirm'));
    expect((await screen.findByRole('alert')).textContent).toBe('Connect Claude in Connections before starting an agent.');
  });

  it('reads skill names with or without slashes, and starts queued or done tickets at Planning', () => {
    expect(parseSkillNames(' /code-review, commit  /code-review ')).toEqual(['code-review', 'commit']);
    expect(defaultStage('queued')).toBe('planning');
    expect(defaultStage('done')).toBe('planning');
    expect(defaultStage('qa')).toBe('qa');
    expect(defaultStage(undefined)).toBe('planning');
  });
});
