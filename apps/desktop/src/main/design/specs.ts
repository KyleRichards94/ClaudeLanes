import { err, ok, type DesignSpec, type Result, type TicketDesignSpec } from '@agent-lanes/contracts';
import type { TranscriptService } from '../agent/output/transcript';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import type { DesignSpecFiles } from './spec-store';

/**
 * The ticket's shipped design specs as the agent and the design tab see them (AL-198, D16).
 *
 * The agent pulls a spec with `agent_lanes.get_design_spec` (the latest by default) and confirms it
 * built from it with `ack_design_spec`. Fetching the latest spec marks it fetched, so the design tab
 * shows "Agent is watching this canvas" until the acknowledgement, which marks it "Used · 14:01".
 * Both are saved on the ticket record, so they survive a restart, and sent as `design:spec`.
 */
export interface DesignSpecService {
  /** The record's specs, oldest first. */
  list(ticketId: string): Promise<Result<readonly TicketDesignSpec[]>>;
  /**
   * One spec, the latest when `version` is left out. `fetchedByAgent` marks the latest spec fetched
   * (the agent's `get_design_spec`); the design tab's own reads leave it as it is.
   */
  get(ticketId: string, version?: number, options?: { fetchedByAgent?: boolean }): Promise<Result<DesignSpec>>;
  /** The agent built from the spec (`ack_design_spec`): "Used · 14:01". */
  ack(ticketId: string, version: number, note: string): Promise<Result<TicketDesignSpec>>;
}

export interface DesignSpecServiceOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  files: DesignSpecFiles;
  emit: Emit;
  transcripts?: Pick<TranscriptService, 'appendSystem'>;
  log?: Pick<Logger, 'info' | 'warn'>;
  now?: () => number;
}

export const NO_DESIGN_SPEC_MESSAGE = 'No design has been shipped to this ticket yet.';

function oneLine(text: string, limit = 200): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

export function createDesignSpecService(options: DesignSpecServiceOptions): DesignSpecService {
  const { tickets, files, emit } = options;
  const now = options.now ?? Date.now;

  async function markSpec(ticketId: string, version: number, change: (spec: TicketDesignSpec) => TicketDesignSpec): Promise<Result<TicketDesignSpec>> {
    let changed: TicketDesignSpec | undefined;
    const saved = await tickets.update(ticketId, (record) => ({
      ...record,
      design: {
        ...record.design,
        specs: record.design.specs.map((spec) => {
          if (spec.version !== version) return spec;
          changed = change(spec);
          return changed;
        }),
      },
    }));
    if (!saved.ok) return saved;
    return changed ? ok(changed) : err('VALIDATION', `There is no Design v${version} on ticket ${ticketId}.`);
  }

  return {
    async list(ticketId) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      return ok(record.design.specs);
    },

    async get(ticketId, version, getOptions = {}) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      const latest = record.design.specs.at(-1);
      if (!latest) return err('VALIDATION', NO_DESIGN_SPEC_MESSAGE);
      const wanted = version ?? latest.version;
      const entry = record.design.specs.find((spec) => spec.version === wanted);
      if (!entry) return err('VALIDATION', `There is no Design v${wanted}; the latest is v${latest.version}.`);
      const spec = await files.read(record.repo, ticketId, wanted);
      if (!spec) return err('INTERNAL', `Design v${wanted} could not be read from the app data folder.`);

      if (getOptions.fetchedByAgent && wanted === latest.version && entry.usedAt === null && !entry.fetchedAt) {
        const marked = await markSpec(ticketId, wanted, (current) => ({ ...current, fetchedAt: now() }));
        if (marked.ok) emit('design:spec', { ticketId, version: wanted, change: 'fetched' });
        else options.log?.warn(`Could not mark Design v${wanted} of ticket ${ticketId} fetched: ${marked.message}`);
      }
      return ok(spec);
    },

    async ack(ticketId, version, note) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      const entry = record.design.specs.find((spec) => spec.version === version);
      if (!entry) {
        const latest = record.design.specs.at(-1);
        return err('VALIDATION', latest ? `There is no Design v${version}; the latest is v${latest.version}.` : NO_DESIGN_SPEC_MESSAGE);
      }
      if (entry.usedAt !== null) return ok(entry);
      const at = now();
      const marked = await markSpec(ticketId, version, (current) => ({ ...current, usedAt: at, fetchedAt: current.fetchedAt ?? at }));
      if (!marked.ok) return marked;
      emit('design:spec', { ticketId, version, change: 'used' });
      const detail = oneLine(note);
      options.transcripts?.appendSystem(ticketId, `Design v${version} used by the agent${detail ? ` · ${detail}` : ''}`);
      options.log?.info(`Ticket ${ticketId}: the agent acknowledged Design v${version}`);
      return marked;
    },
  };
}

/** Sent / Used / Superseded, as `list_design_specs` reports it to the agent. */
export function specStatusText(spec: TicketDesignSpec, latestVersion: number): string {
  if (spec.version < latestVersion) return `superseded by v${latestVersion}`;
  return spec.usedAt !== null ? 'used (acknowledged)' : 'sent, not yet acknowledged';
}

/** What `get_design_spec` returns: a short header the agent reads first, then the spec as JSON. */
export function specForAgent(spec: DesignSpec): string {
  const header = [
    `Design v${spec.version}, approved by ${spec.approvedBy} at ${new Date(spec.shippedAt).toISOString()}, ${spec.artboards.length} artboard${spec.artboards.length === 1 ? '' : 's'}.`,
    spec.supersedes ? `It supersedes v${spec.supersedes}: where they differ, follow v${spec.version}.` : null,
    spec.reshipOf ? `It is v${spec.reshipOf} shipped again: the user went back to that design.` : null,
    spec.note ? `The user's note: ${spec.note}` : null,
    `Use the design system in ${spec.tokensFile} for colours, type, spacing and radii.`,
    `When you have built from it (or adjusted the plan or review to it), call ack_design_spec with version ${spec.version} and a one-line note.`,
  ].filter(Boolean);
  return `${header.join('\n')}\n\n${JSON.stringify(spec, null, 2)}`;
}
