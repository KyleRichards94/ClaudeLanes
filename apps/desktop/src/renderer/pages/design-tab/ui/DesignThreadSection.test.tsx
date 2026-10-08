import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignThread } from '@agent-lanes/contracts';
import { designThreadEventHandlers } from '@/shared/api';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { DesignThreadSection } from './DesignThreadSection';

vi.setConfig({ testTimeout: 30_000 });

const EMPTY: DesignThread = { ticketId: '71273', status: 'idle', reason: null, messages: [], approval: null };
const AT = new Date(2026, 9, 8, 14, 1).getTime();

let bridge: FakeBridge;
let client: QueryClient;
let saved: DesignThread;

function renderSection(props: { canvasLinked?: boolean; inApp?: boolean } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DesignThreadSection ticketId="71273" canvasLinked={props.canvasLinked ?? true} inApp={props.inApp ?? true} />
    </QueryClientProvider>,
  );
}

function push(thread: DesignThread) {
  act(() => designThreadEventHandlers(client)['design:thread']?.({ ticketId: '71273', at: AT, thread }));
}

function calls(channel: string): unknown[] {
  return vi.mocked(bridge.invoke).mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload);
}

describe('DesignThreadSection (AL-196)', () => {
  beforeEach(() => {
    saved = EMPTY;
    bridge = installFakeBridge({});
    vi.mocked(bridge.invoke).mockImplementation(async (channel, request) => {
      if (channel === 'design:getThread') return { ok: true, data: saved };
      if (channel === 'design:sendThreadMessage') {
        const text = (request as { text: string }).text;
        return { ok: true, data: { ...saved, status: 'replying', messages: [...saved.messages, { id: 'u1', role: 'user', text, at: AT }] } };
      }
      if (channel === 'design:answerThreadApproval') return { ok: true, data: { ...saved, approval: null } };
      return { ok: false, code: 'INTERNAL', message: 'no fake reply' };
    });
  });

  it('sends a message to the design side and shows the reply when it arrives', async () => {
    renderSection();
    expect(await screen.findByTestId('design-thread-empty')).toBeTruthy();

    const send = screen.getByRole('button', { name: 'Send to design' });
    expect(send.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message to the design side' }), { target: { value: '  Narrow the filter panel  ' } });
    fireEvent.click(send);

    await waitFor(() => expect(calls('design:sendThreadMessage')).toEqual([{ ticketId: '71273', text: 'Narrow the filter panel' }]));
    expect(await screen.findByText('Narrow the filter panel')).toBeTruthy();
    expect(screen.getByTestId('design-thread-status').textContent).toBe('Design is replying…');
    expect((screen.getByRole('textbox', { name: 'Message to the design side' }) as HTMLTextAreaElement).value).toBe('');

    push({
      ...EMPTY,
      messages: [
        { id: 'u1', role: 'user', text: 'Narrow the filter panel', at: AT },
        { id: 'd1', role: 'design', text: 'JobFilter is 420 px; 360 px keeps the date pickers on one line.', at: AT },
      ],
    });
    expect(await screen.findByText('JobFilter is 420 px; 360 px keeps the date pickers on one line.')).toBeTruthy();
    expect(screen.getByText('Design · 14:01')).toBeTruthy();
    expect(screen.getByText('You · 14:01')).toBeTruthy();
    expect(screen.getByTestId('design-thread-status').textContent).toBe('');
  });

  it('shows the saved history when the tab opens again', async () => {
    saved = { ...EMPTY, messages: [{ id: 'd1', role: 'design', text: 'Earlier reply', at: AT }] };
    renderSection();
    expect(await screen.findByText('Earlier reply')).toBeTruthy();
    cleanup();
    renderSection();
    expect(await screen.findByText('Earlier reply')).toBeTruthy();
    expect(calls('design:getThread')).toHaveLength(2);
  });

  it('asks the user to approve a canvas change, and sends the answer', async () => {
    saved = { ...EMPTY, status: 'replying', approval: { id: 'a1', operation: 'finalize_plan', summary: '{ "plan": "Narrow JobFilter" }', at: AT } };
    renderSection();
    const card = await screen.findByTestId('design-thread-approval');
    expect(card.textContent).toContain('Needs you · change the canvas (finalize_plan)');
    expect(card.textContent).toContain('Narrow JobFilter');

    fireEvent.click(screen.getByRole('button', { name: 'Approve change' }));
    await waitFor(() => expect(calls('design:answerThreadApproval')).toEqual([{ ticketId: '71273', approvalId: 'a1', approve: true }]));
    await waitFor(() => expect(screen.queryByTestId('design-thread-approval')).toBeNull());
  });

  it('declines a canvas change', async () => {
    saved = { ...EMPTY, approval: { id: 'a2', operation: 'delete_files', summary: '{}', at: AT } };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(calls('design:answerThreadApproval')).toEqual([{ ticketId: '71273', approvalId: 'a2', approve: false }]));
  });

  it('says why when Claude Design is not available, and shows failure notices', async () => {
    saved = {
      ...EMPTY,
      status: 'unavailable',
      reason: "Claude Design isn't available for this Claude login.",
      messages: [{ id: 'n1', role: 'notice', text: 'The design session stopped.', at: AT, error: true }],
    };
    renderSection();
    expect(await screen.findByText("Claude Design isn't available for this Claude login.")).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('14:01 · The design session stopped.');
  });

  it("points to the canvas's own chat in webview mode, and reads no thread", async () => {
    renderSection({ inApp: false });
    expect(screen.getByTestId('design-thread-canvas-chat').textContent).toContain("canvas's own Claude chat");
    expect(screen.queryByRole('textbox', { name: 'Message to the design side' })).toBeNull();
    expect(calls('design:getThread')).toHaveLength(0);
  });

  it('asks for a canvas first when none is linked', () => {
    renderSection({ canvasLinked: false });
    expect(screen.getByText('Link a canvas to talk to the design side of this ticket.')).toBeTruthy();
    expect(calls('design:getThread')).toHaveLength(0);
  });
});
