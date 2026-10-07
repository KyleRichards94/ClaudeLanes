import { describe, expect, it } from 'vitest';
import { eventContracts } from '../schemas';
import { TOAST_MAX_ACTIONS, ToastEventSchema } from './app.schemas';

const openTicket = { label: 'Open ticket', intent: { type: 'navigate', route: { name: 'ticket', ticketId: '71273' } } };

describe('toast event actions (AL-030)', () => {
  it('is the contract on the toast channel', () => {
    expect(eventContracts.toast).toBe(ToastEventSchema);
  });

  it('carries an optional id and up to two actions, each a label and an intent', () => {
    const parsed = ToastEventSchema.parse({
      at: 1,
      id: 'build-failed:71273',
      tone: 'error',
      title: 'Build failed',
      body: '3 errors in JobControl.razor',
      actions: [openTicket, { label: 'Board', intent: { type: 'navigate', route: { name: 'board' } } }],
    });
    expect(parsed.id).toBe('build-failed:71273');
    expect(parsed.actions).toHaveLength(TOAST_MAX_ACTIONS);
    expect(parsed.actions?.[0]).toEqual(openTicket);
  });

  it('still accepts the AL-012 shape with no id or actions', () => {
    expect(ToastEventSchema.parse({ at: 1, tone: 'info', title: 'Saved' })).toEqual({ at: 1, tone: 'info', title: 'Saved' });
  });

  it('opens only the three router pages, with a valid ticket id', () => {
    const navigate = (route: unknown) =>
      ToastEventSchema.safeParse({ tone: 'info', title: 'x', actions: [{ label: 'Go', intent: { type: 'navigate', route } }] }).success;

    expect(navigate({ name: 'board' })).toBe(true);
    expect(navigate({ name: 'ticket', ticketId: '71273' })).toBe(true);
    expect(navigate({ name: 'ticketDesign', ticketId: 'nt-20261007-fix-login' })).toBe(true);
    expect(navigate({ name: 'settings' })).toBe(false);
    expect(navigate({ name: 'ticket' })).toBe(false);
    expect(navigate({ name: 'ticket', ticketId: '../secrets' })).toBe(false);
  });

  it('refuses an unknown intent, an empty or long label, a third action and an empty id', () => {
    const withActions = (actions: unknown) => ToastEventSchema.safeParse({ tone: 'error', title: 'x', actions }).success;

    expect(withActions([{ label: 'Run', intent: { type: 'invoke', channel: 'agent:start' } }])).toBe(false);
    expect(withActions([{ label: '', intent: openTicket.intent }])).toBe(false);
    expect(withActions([{ label: 'x'.repeat(41), intent: openTicket.intent }])).toBe(false);
    expect(withActions([openTicket, openTicket, openTicket])).toBe(false);
    expect(ToastEventSchema.safeParse({ id: '', tone: 'info', title: 'x' }).success).toBe(false);
  });

  it('drops a callback or any other field it does not declare, so only data crosses IPC', () => {
    const parsed = ToastEventSchema.parse({
      tone: 'error',
      title: 'x',
      actions: [{ ...openTicket, onPress: () => undefined, token: 'not-a-real-secret' }],
    });
    expect(parsed.actions?.[0]).toEqual(openTicket);
  });
});
