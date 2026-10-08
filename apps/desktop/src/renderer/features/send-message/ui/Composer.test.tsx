import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { InvokeChannel } from '@agent-lanes/contracts';
import { sessionStatusEventHandlers, subscribe } from '@/shared/api';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { Composer } from './Composer';

const status = (state: string) => ({ ticketId: '71273', state, sessionId: 'cc-71273', message: null });

function EventRoute({ client }: { client: QueryClient }) {
  useEffect(() => subscribe('agent:status', sessionStatusEventHandlers(client)['agent:status']!), [client]);
  return null;
}

function renderComposer({ skills = ['code-review', 'commit'], switching = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventRoute client={client} />
      <Composer ticketId="71273" skills={skills} switching={switching} />
    </QueryClientProvider>,
  );
}

/** A fake session in main: pause holds sends until resume, as the session manager does (AL-105). */
function fakeSession(initial = 'running'): FakeBridge {
  const bridge = installFakeBridge();
  let state = initial;
  bridge.invoke = vi.fn(async (channel: InvokeChannel) => {
    switch (channel) {
      case 'agent:getStatus':
        return { ok: true, data: status(state) };
      case 'agent:pause':
        state = 'paused';
        return { ok: true, data: status(state) };
      case 'agent:resume':
        state = 'running';
        return { ok: true, data: status(state) };
      case 'agent:send':
        return { ok: true, data: { held: state === 'paused' } };
      case 'agent:applyModelNow':
        return { ok: true, data: { ticketId: '71273', model: 'sonnet', effort: 'high', pending: null } };
      default:
        return { ok: false, code: 'INTERNAL', message: 'no fake reply' };
    }
  }) as FakeBridge['invoke'];
  return bridge;
}

/** Waits for the session status to load: Pause (or Resume) is enabled. */
async function ready(name = 'Pause') {
  await waitFor(() => expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).not.toBe('true'));
}

function type(text: string) {
  fireEvent.change(screen.getByTestId('composer-input'), { target: { value: text } });
}

function calls(bridge: FakeBridge) {
  return (bridge.invoke as ReturnType<typeof vi.fn>).mock.calls.map(([channel, payload]) => [channel, payload]).filter(([channel]) => channel !== 'agent:getStatus');
}

describe('Composer (AL-176)', () => {
  it('queues messages sent while paused and delivers them on Resume', async () => {
    const bridge = fakeSession();
    renderComposer();

    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Paused · messages you send now are delivered on Resume')).toBeTruthy();

    type('Use the existing JobFilterState');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Paused · 1 message queued, delivered on Resume')).toBeTruthy();
    expect((screen.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('');

    type('And keep frmJobNotes as WinForms');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Paused · 2 messages queued, delivered on Resume')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(screen.queryByTestId('composer-note')).toBeNull());
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

    expect(calls(bridge)).toEqual([
      ['agent:pause', { ticketId: '71273' }],
      ['agent:send', { ticketId: '71273', text: 'Use the existing JobFilterState' }],
      ['agent:send', { ticketId: '71273', text: 'And keep frmJobNotes as WinForms' }],
      ['agent:resume', { ticketId: '71273' }],
    ]);
  });

  it('follows pause and resume made elsewhere through agent:status', async () => {
    const bridge = fakeSession();
    renderComposer();
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
    act(() => bridge.emit('agent:status', { ...status('paused'), at: 1 }));
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('sends on Ctrl+Enter but not on Enter, and "Steer now" sends with priority now', async () => {
    const bridge = fakeSession();
    renderComposer();
    await ready();

    type('first');
    fireEvent.keyDown(screen.getByTestId('composer-input'), { key: 'Enter' });
    expect(calls(bridge)).toEqual([]);
    fireEvent.keyDown(screen.getByTestId('composer-input'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(calls(bridge)).toEqual([['agent:send', { ticketId: '71273', text: 'first' }]]));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Steer now' }));
    expect(screen.getByRole('checkbox', { name: 'Steer now' }).getAttribute('aria-checked')).toBe('true');
    type('stop editing the grid');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls(bridge).at(-1)).toEqual(['agent:send', { ticketId: '71273', text: 'stop editing the grid', priority: 'now' }]));
    // Steer now applies to one message.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Steer now' }).getAttribute('aria-checked')).toBe('false'));
  });

  it('runs a skill chip as /skill-name and applies a waiting model change now', async () => {
    const bridge = fakeSession();
    renderComposer({ switching: true });
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Run /code-review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply model now' }));
    await waitFor(() =>
      expect(calls(bridge)).toEqual([
        ['agent:send', { ticketId: '71273', text: '/code-review' }],
        ['agent:applyModelNow', { ticketId: '71273' }],
      ]),
    );
  });

  it('keeps Send off for an empty box and shows why a send failed', async () => {
    const bridge = installFakeBridge({
      'agent:getStatus': { ok: true, data: status('none') },
      'agent:send': { ok: false, code: 'VALIDATION', message: 'No agent session is running for ticket 71273.' },
    });
    renderComposer();
    expect(await screen.findByText('No agent session is running for this ticket.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pause' }).getAttribute('aria-disabled')).toBe('true');

    type('hello');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No agent session is running for ticket 71273.');
    expect(bridge.invoke).toHaveBeenCalledWith('agent:send', { ticketId: '71273', text: 'hello' });
  });
});
