import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionSummary } from '@agent-lanes/contracts';
import type { ConnectionsService } from '../../connections';
import type { Emit } from '../../ipc/emit';
import { createTicketRecordStore, type TicketRecordStore } from '../../tickets';
import { createMemoryRecordFs, newTicketInput } from '../../tickets/testing';
import type { NewTicketRecord } from '../../tickets/record';

/** Test helpers for the session manager (AL-100) and the tickets built on it (AL-102–AL-115). */

/** Where test tickets live; nothing is written there (records are in memory). */
export const SESSION_TEST_BASE = join(tmpdir(), 'agent-lanes-session-tests');

/** A Claude connection as the connections service would report it, without any token. */
export function fakeClaudeConnections(
  mode: 'login' | 'api-key' | 'none' = 'login',
  apiKey?: string,
): Pick<ConnectionsService, 'get' | 'secret'> {
  const summary = {
    id: 'claude',
    kind: 'claude',
    name: 'Claude',
    mode,
    status: 'ok',
  } as unknown as ConnectionSummary;
  return {
    get: async (id) => (mode !== 'none' && id === 'claude' ? summary : undefined),
    secret: async (id) => (id === 'claude' && mode === 'api-key' ? apiKey : undefined),
  };
}

/** A ticket record store in memory, holding the given tickets. */
export async function memoryTickets(...inputs: Array<Partial<NewTicketRecord>>): Promise<TicketRecordStore> {
  const tickets = createTicketRecordStore({ rootDir: join(SESSION_TEST_BASE, 'user-data', 'tickets'), fs: createMemoryRecordFs(), warn: () => undefined });
  for (const input of inputs) {
    const created = await tickets.create(newTicketInput(SESSION_TEST_BASE, input));
    if (!created.ok) throw new Error(created.message);
  }
  return tickets;
}

export interface RecordedEvent {
  channel: string;
  payload: Record<string, unknown>;
}

/** An `emit` that records what it was given. */
export function recordingEmit(): { emit: Emit; events: RecordedEvent[]; of: (channel: string, ticketId?: string) => Array<Record<string, unknown>> } {
  const events: RecordedEvent[] = [];
  const emit = ((channel: string, payload: Record<string, unknown>) => {
    events.push({ channel, payload });
  }) as unknown as Emit;
  return {
    emit,
    events,
    of: (channel, ticketId) => events.filter((event) => event.channel === channel && (ticketId === undefined || event.payload['ticketId'] === ticketId)).map((event) => event.payload),
  };
}

/** Resolves once `check` passes, polling every few milliseconds (for stream loops that run on their own). */
export async function eventually(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
