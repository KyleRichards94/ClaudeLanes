import { describe, expect, it } from 'vitest';
import { EventEnvelopeSchema, TicketEventEnvelopeSchema } from './events';
import { EVENT_CHANNEL_NAMES, INVOKE_CHANNEL_NAMES } from './names';
import { eventContracts } from './schemas';

describe('event contracts', () => {
  it('declares the main → renderer channels from AL-012', () => {
    expect([...EVENT_CHANNEL_NAMES].sort()).toEqual(
      [
        'agent:gate',
        'agent:model', // AL-106
        'agent:output',
        'agent:stage',
        'agent:status',
        'agent:subagent',
        'build:log',
        'build:queued', // AL-131
        'build:finished', // AL-132
        'connections:changed',
        'design:spec',
        'design:view', // AL-191
        'run:status',
        'toast',
        'app:window', // AL-066
      ].sort(),
    );
  });

  it('has exactly one payload schema per event channel', () => {
    expect(Object.keys(eventContracts).sort()).toEqual([...EVENT_CHANNEL_NAMES].sort());
  });

  it('never reuses an invoke channel name for an event', () => {
    const invoke = new Set<string>(INVOKE_CHANNEL_NAMES);
    expect(EVENT_CHANNEL_NAMES.filter((name) => invoke.has(name))).toEqual([]);
  });

  it('puts ticketId and at on every ticket event', () => {
    for (const channel of ['agent:output', 'agent:stage', 'agent:subagent', 'agent:gate', 'agent:status', 'design:spec'] as const) {
      const schema = eventContracts[channel];
      // The envelope fields are there whatever the owning ticket added (AL-100 onwards).
      expect(Object.keys(schema.shape), channel).toEqual(expect.arrayContaining(['ticketId', 'at']));
      expect(schema.shape.ticketId.safeParse('71273').success, channel).toBe(true);
      expect(schema.safeParse({ at: 1_760_000_000_000 }).success, `${channel} without ticketId`).toBe(false);
    }
  });
});

describe('event envelope', () => {
  it('stamps the current time when at is missing', () => {
    const before = Date.now();
    const { at } = EventEnvelopeSchema.parse({});
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('keeps a given time and refuses one that is not epoch milliseconds', () => {
    expect(TicketEventEnvelopeSchema.parse({ ticketId: '71273', at: 42 }).at).toBe(42);
    expect(TicketEventEnvelopeSchema.safeParse({ ticketId: '71273', at: '14:01' }).success).toBe(false);
    expect(TicketEventEnvelopeSchema.safeParse({ ticketId: '71273', at: -1 }).success).toBe(false);
  });

  it('refuses an empty ticket id', () => {
    expect(TicketEventEnvelopeSchema.safeParse({ ticketId: '', at: 42 }).success).toBe(false);
  });

  it('drops fields a contract does not declare, so they never cross IPC', () => {
    const status = { ticketId: '71273', at: 42, state: 'idle', sessionId: null, message: null } as const;
    expect(eventContracts['agent:status'].parse({ ...status, token: 'not-a-real-secret' })).toEqual(status);
  });
});

describe('toast event', () => {
  it('needs a tone and a title', () => {
    expect(eventContracts.toast.safeParse({ tone: 'error', title: 'MCP bridge lost the session' }).success).toBe(true);
    expect(eventContracts.toast.safeParse({ tone: 'loud', title: 'x' }).success).toBe(false);
    expect(eventContracts.toast.safeParse({ tone: 'info', title: '' }).success).toBe(false);
  });
});
