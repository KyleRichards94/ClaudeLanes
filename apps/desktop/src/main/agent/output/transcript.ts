import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { TRANSCRIPT_CAPACITY, type AgentOutputEvent, type AgentOutputItem, type AgentTranscript } from '@agent-lanes/contracts';
import type { Emit } from '../../ipc/emit';
import type { Logger } from '../../logging';
import type { TicketRecordStore } from '../../tickets';
import type { SessionManager } from '../session-manager';
import { createOutputNormaliser, firstLine, type OutputNormaliser } from './normalise';

/**
 * Each ticket's output (AL-102): every session message is normalised, numbered and pushed to the
 * renderer as `agent:output`, and the last `capacity` events are kept here, so a reloaded renderer
 * or a newly opened drill-in backfills with `agent:getTranscript` and then continues live.
 *
 * Live events get seq 1, 2, 3… per ticket. When the session was resumed (after a restart), the
 * output from before is read back from the saved session once, on the first backfill, and gets seqs
 * at or below 0. Streamed text deltas are dropped from the buffer once their finished text arrives.
 */
export interface TranscriptService {
  get(ticketId: string): Promise<AgentTranscript>;
  /** A line from the app in the ticket's output ("Plan approved by Kyle · moved to Implementing"). */
  appendSystem(ticketId: string, text: string): void;
  /** Stops listening to sessions. */
  dispose(): void;
}

export interface TranscriptServiceOptions {
  sessions: Pick<SessionManager, 'subscribe'>;
  tickets: Pick<TicketRecordStore, 'get'>;
  emit: Emit;
  /** Events kept per ticket. */
  capacity?: number;
  /** The saved messages of a session (the SDK's `getSessionMessages`); without it, no history is read. */
  history?: (sessionId: string, dir: string) => Promise<SessionMessage[]>;
  log?: Pick<Logger, 'warn'>;
  now?: () => number;
}

interface TicketOutput {
  lastSeq: number;
  events: AgentOutputEvent[];
  normaliser: OutputNormaliser | undefined;
  /** Ids of messages seen live, so the saved history adds only older ones. */
  seen: Set<string>;
  /** True once there is nothing older to read: the session started fresh, or the history was read. */
  historyDone: boolean;
  historyLoading: Promise<void> | undefined;
}

/** A saved message as the stream would have delivered it (history has no structured tool results). */
function fromSessionMessage(message: SessionMessage): SDKMessage | null {
  if (message.type !== 'assistant' && message.type !== 'user') return null;
  return { type: message.type, message: message.message, parent_tool_use_id: message.parent_tool_use_id, uuid: message.uuid, session_id: message.session_id } as unknown as SDKMessage;
}

export function createTranscriptService(options: TranscriptServiceOptions): TranscriptService {
  const { tickets, emit } = options;
  const capacity = options.capacity ?? TRANSCRIPT_CAPACITY;
  const now = options.now ?? Date.now;
  const outputs = new Map<string, TicketOutput>();

  function outputOf(ticketId: string): TicketOutput {
    let output = outputs.get(ticketId);
    if (!output) {
      output = { lastSeq: 0, events: [], normaliser: undefined, seen: new Set(), historyDone: false, historyLoading: undefined };
      outputs.set(ticketId, output);
    }
    return output;
  }

  function keep(output: TicketOutput, event: AgentOutputEvent): void {
    const { item } = event;
    if (item.kind === 'text') {
      // The finished text supersedes its streamed deltas.
      output.events = output.events.filter(
        ({ item: kept }) => !(kept.kind === 'text-delta' && kept.streamId === item.streamId && kept.parentToolUseId === item.parentToolUseId),
      );
    }
    output.events.push(event);
    if (output.events.length > capacity) output.events.splice(0, output.events.length - capacity);
  }

  function publish(ticketId: string, output: TicketOutput, item: AgentOutputItem): void {
    output.lastSeq += 1;
    const event: AgentOutputEvent = { ticketId, at: now(), seq: output.lastSeq, item };
    keep(output, event);
    emit('agent:output', event);
  }

  const unsubscribe = options.sessions.subscribe(({ ticketId, cwd, resumed, message }) => {
    const output = outputOf(ticketId);
    if (!output.normaliser) {
      output.normaliser = createOutputNormaliser({ cwd });
      // A fresh session has no older output to read back.
      if (!resumed && output.lastSeq === 0) output.historyDone = true;
    }
    if (message.type !== 'stream_event' && 'uuid' in message && typeof message.uuid === 'string') output.seen.add(message.uuid);
    for (const item of output.normaliser.normalise(message)) publish(ticketId, output, item);
  });

  async function loadHistory(ticketId: string, output: TicketOutput): Promise<void> {
    const record = await tickets.get(ticketId);
    if (!record?.sessionId || !options.history) {
      output.historyDone = true;
      return;
    }
    let messages: SessionMessage[];
    try {
      messages = await options.history(record.sessionId, record.worktreePath);
    } catch (error) {
      // Not marked done: the next backfill tries again.
      options.log?.warn(`Could not read the saved output of ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const normaliser = createOutputNormaliser({ cwd: record.worktreePath });
    const items: Array<{ item: AgentOutputItem; at: number }> = [];
    for (const saved of messages) {
      if (output.seen.has(saved.uuid)) continue;
      const message = fromSessionMessage(saved);
      if (!message) continue;
      for (const item of normaliser.normalise(message)) items.push({ item, at: 0 });
    }
    const older: AgentOutputEvent[] = items.map(({ item, at }, index) => ({ ticketId, at, seq: index - items.length + 1, item }));
    output.events = [...older, ...output.events].slice(-capacity);
    output.historyDone = true;
  }

  return {
    async get(ticketId) {
      const output = outputOf(ticketId);
      if (!output.historyDone) {
        output.historyLoading ??= loadHistory(ticketId, output).finally(() => {
          output.historyLoading = undefined;
        });
        await output.historyLoading;
      }
      return { ticketId, events: [...output.events], lastSeq: output.lastSeq };
    },

    appendSystem(ticketId, text) {
      publish(ticketId, outputOf(ticketId), { kind: 'system', text: firstLine(text), parentToolUseId: null });
    },

    dispose() {
      unsubscribe();
    },
  };
}
