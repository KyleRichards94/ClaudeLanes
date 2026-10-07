import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ToastEvent, ToastTone as EventToastTone } from '@agent-lanes/contracts';
import type { ToastTone } from '@agent-lanes/ui';
import { autoDismisses, clearToasts, dismissToast, getToasts, toast, toastEventHandlers, toastFromEvent } from './toasts';

const openTicket = { type: 'navigate', route: { name: 'ticket', ticketId: '71273' } } as const;

beforeEach(() => {
  clearToasts();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toast()', () => {
  it('adds a toast at the end of the stack and returns its id', () => {
    const first = toast({ tone: 'info', title: 'Saved' });
    const second = toast({ tone: 'error', title: 'MCP bridge lost the session', body: 'cc-71288 stopped responding.' });

    expect(first).not.toBe(second);
    expect(getToasts()).toEqual([
      { id: first, revision: 0, tone: 'info', title: 'Saved', body: undefined, actions: [] },
      { id: second, revision: 0, tone: 'error', title: 'MCP bridge lost the session', body: 'cc-71288 stopped responding.', actions: [] },
    ]);
  });

  it('replaces a toast raised again under the same id in place, instead of stacking a copy', () => {
    toast({ tone: 'info', title: 'Saved' });
    toast({ id: 'ado-unauthorized:contoso', tone: 'error', title: 'Azure DevOps rejected the token' });
    toast({ tone: 'info', title: 'Copied' });
    const id = toast({ id: 'ado-unauthorized:contoso', tone: 'error', title: 'Azure DevOps rejected the token again' });

    expect(id).toBe('ado-unauthorized:contoso');
    expect(getToasts().map((entry) => [entry.title, entry.revision])).toEqual([
      ['Saved', 0],
      ['Azure DevOps rejected the token again', 1],
      ['Copied', 0],
    ]);
  });

  it('keeps the first two actions and warns about the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const actions = ['One', 'Two', 'Three'].map((label) => ({ label, onPress: vi.fn() }));
    toast({ tone: 'error', title: 'Too many buttons', actions });

    expect(getToasts()[0]?.actions.map((action) => action.label)).toEqual(['One', 'Two']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('closes a toast by id, and ignores an id that has already gone', () => {
    const id = toast({ tone: 'error', title: 'Build failed' });
    toast({ tone: 'info', title: 'Saved' });
    dismissToast(id);
    dismissToast(id);
    dismissToast('never-raised');

    expect(getToasts().map((entry) => entry.title)).toEqual(['Saved']);
  });

  it('auto-dismisses info toasts only', () => {
    expect(autoDismisses({ tone: 'info' })).toBe(true);
    expect(autoDismisses({ tone: 'success' })).toBe(false);
    expect(autoDismisses({ tone: 'warning' })).toBe(false);
    expect(autoDismisses({ tone: 'error' })).toBe(false);
  });

  it('uses the same tones as the toast event and the Toast primitive', () => {
    expectTypeOf<EventToastTone>().toEqualTypeOf<ToastTone>();
  });
});

describe('toast events from the main process', () => {
  const event: ToastEvent = {
    at: 1,
    id: 'build-failed:71273',
    tone: 'error',
    title: 'Build failed',
    body: '3 errors',
    actions: [{ label: 'Open ticket', intent: openTicket }],
  };

  it('become toast input with the action intents kept for the host to carry out', () => {
    expect(toastFromEvent(event)).toEqual({
      id: 'build-failed:71273',
      tone: 'error',
      title: 'Build failed',
      body: '3 errors',
      actions: [{ label: 'Open ticket', intent: openTicket }],
    });
    expect(toastFromEvent({ at: 2, tone: 'info', title: 'Saved' })).toEqual({
      id: undefined,
      tone: 'info',
      title: 'Saved',
      body: undefined,
      actions: [],
    });
  });

  it('are shown by the handler the event hub registers', () => {
    toastEventHandlers.toast?.(event);
    toastEventHandlers.toast?.({ ...event, title: 'Build failed again' });

    expect(getToasts()).toEqual([
      {
        id: 'build-failed:71273',
        revision: 1,
        tone: 'error',
        title: 'Build failed again',
        body: '3 errors',
        actions: [{ label: 'Open ticket', intent: openTicket }],
      },
    ]);
  });
});
