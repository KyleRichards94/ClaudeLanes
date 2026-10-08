import { userInfo } from 'node:os';
import {
  DESIGN_TOKENS_FILE,
  err,
  ok,
  type DesignSpec,
  type Result,
  type ShipDesignSpecRequest,
  type ShippedDesignSpec,
  type TicketDesignSpec,
} from '@agent-lanes/contracts';
import type { TranscriptService } from '../agent/output/transcript';
import type { SessionManager } from '../agent/session-manager';
import { firstName } from '../agent/stages/stage-service';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import { createKeyedQueue } from '../worktrees/keyed-queue';
import type { ArtboardSourceReader } from './artboard-sources';
import type { DesignSpecFiles } from './spec-store';

/**
 * Approve & ship design at any time (AL-197, R11, Decisions D8, D11, D16).
 *
 * Shipping snapshots DesignSpec vN (the picked artboards with their source, the tokens file, the
 * user's note, who approved it and when, the canvas URL) into the app data folder, adds it to the
 * ticket record, writes "Design v2 approved by Kyle · 2 artboards" into the Output stream, and hands
 * it to the ticket's lead agent at once: a short user turn with `priority: 'now'`, so a running turn
 * takes it at its next tool boundary and an idle session starts a turn. The agent pulls the full spec
 * with `get_design_spec` (D16).
 *
 * It never waits on a stage or a gate: a gate the user is deciding keeps its `set_stage` call open,
 * and the spec arrives after that call returns. When there is no live session (queued, stopped, lost),
 * the spec is held and delivered first when the session next starts; while paused, the session
 * manager holds it until Resume.
 */
export interface DesignShipService {
  ship(request: ShipDesignSpecRequest): Promise<Result<ShippedDesignSpec>>;
  /** Ships an earlier version again as the newest version (AL-199); the agent is told it is that design again. */
  reship(ticketId: string, version: number): Promise<Result<ShippedDesignSpec>>;
  /** Hands the latest undelivered spec to the ticket's session; called when a session starts. */
  deliverPending(ticketId: string): Promise<boolean>;
  /** Stops listening to sessions. */
  dispose(): void;
}

export interface DesignShipServiceOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  files: DesignSpecFiles;
  sources: ArtboardSourceReader;
  sessions: Pick<SessionManager, 'send' | 'subscribe'>;
  emit: Emit;
  transcripts?: Pick<TranscriptService, 'appendSystem'>;
  log?: Pick<Logger, 'info' | 'warn'>;
  /** Who approves on this computer ("Design v2 approved by Kyle"). The OS user's first name by default. */
  userName?: () => string;
  now?: () => number;
}

function osUserName(): string {
  try {
    return firstName(userInfo().username);
  } catch {
    return 'you';
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The Output stream line (AL-197 criterion): "Design v2 approved by Kyle · 2 artboards". */
export function shipLine(spec: Pick<DesignSpec, 'version' | 'approvedBy' | 'artboards' | 'reshipOf'>): string {
  return `Design v${spec.version} approved by ${spec.approvedBy} · ${plural(spec.artboards.length, 'artboard')}${spec.reshipOf ? ` · v${spec.reshipOf} shipped again` : ''}`;
}

/** The short user turn that tells the agent a spec is waiting (D16): the full spec comes from `get_design_spec`. */
export function shipMessage(spec: DesignSpec): string {
  const names = spec.artboards.map((artboard) => artboard.name).join(', ');
  return [
    `${shipLine(spec)}: ${names}.`,
    spec.supersedes ? `Design v${spec.version} supersedes v${spec.supersedes}: where they differ, follow v${spec.version}.` : null,
    spec.note ? `Note from ${spec.approvedBy}: ${spec.note}` : null,
    `Call get_design_spec on the agent_lanes server to read it, and take it into account in the stage you are in (Planning: the plan you ask the user to approve; Implementing: adjust course; Code review or QA: check the work against it). Then call ack_design_spec with version ${spec.version}, and mention "Design v${spec.version}" in your next message.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function createDesignShipService(options: DesignShipServiceOptions): DesignShipService {
  const { tickets, files, sessions, emit } = options;
  const now = options.now ?? Date.now;
  const userName = options.userName ?? osUserName;
  // Ships of one ticket happen one at a time, so two clicks can't both take the same version number.
  const queue = createKeyedQueue();

  async function deliver(ticketId: string, spec: DesignSpec): Promise<boolean> {
    const sent = sessions.send(ticketId, { text: shipMessage(spec), priority: 'now' });
    if (!sent.ok) {
      options.log?.info(`Ticket ${ticketId}: Design v${spec.version} is held until its session runs (${sent.message})`);
      return false;
    }
    const at = now();
    const saved = await tickets.update(ticketId, (record) => ({
      ...record,
      design: { ...record.design, specs: record.design.specs.map((entry) => (entry.version === spec.version ? { ...entry, deliveredAt: at } : entry)) },
    }));
    if (!saved.ok) options.log?.warn(`Ticket ${ticketId}: could not note Design v${spec.version} as delivered: ${saved.message}`);
    emit('design:spec', { ticketId, version: spec.version, change: 'delivered' });
    return true;
  }

  async function store(ticketId: string, build: (version: number, supersedes: number | null) => Promise<Result<DesignSpec>>): Promise<Result<ShippedDesignSpec>> {
    return queue(ticketId, async () => {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      const latest = record.design.specs.at(-1)?.version ?? null;
      const built = await build((latest ?? 0) + 1, latest);
      if (!built.ok) return built;
      const spec = built.data;
      try {
        await files.write(record.repo, spec);
      } catch (cause) {
        return err('INTERNAL', `Design v${spec.version} could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      const entry: TicketDesignSpec = {
        version: spec.version,
        shippedAt: spec.shippedAt,
        approvedBy: spec.approvedBy,
        artboardCount: spec.artboards.length,
        usedAt: null,
        fetchedAt: null,
        deliveredAt: null,
      };
      const saved = await tickets.update(ticketId, (current) => ({ ...current, design: { ...current.design, specs: [...current.design.specs, entry] } }));
      if (!saved.ok) return saved;
      options.transcripts?.appendSystem(ticketId, shipLine(spec));
      emit('design:spec', { ticketId, version: spec.version, change: 'shipped' });
      options.log?.info(`Ticket ${ticketId}: ${shipLine(spec)}`);
      const delivered = await deliver(ticketId, spec);
      return ok({ spec: delivered ? { ...entry, deliveredAt: now() } : entry, delivered });
    });
  }

  async function deliverPending(ticketId: string): Promise<boolean> {
    const record = await tickets.get(ticketId);
    const latest = record?.design.specs.at(-1);
    if (!record || !latest || latest.deliveredAt || latest.usedAt !== null) return false;
    const spec = await files.read(record.repo, ticketId, latest.version);
    if (!spec) return false;
    return deliver(ticketId, spec);
  }

  // A session starting (new or resumed) gets a held spec first.
  const unsubscribe = sessions.subscribe(({ ticketId, message }) => {
    if (message.type !== 'system' || message.subtype !== 'init') return;
    deliverPending(ticketId).catch((cause) => options.log?.warn(`Ticket ${ticketId}: delivering a held design spec failed: ${cause instanceof Error ? cause.message : String(cause)}`));
  });

  return {
    ship: ({ ticketId, artboards, note }) =>
      store(ticketId, async (version, supersedes) => {
        const record = await tickets.get(ticketId);
        if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
        const canvas = record.design.canvas;
        const sources = canvas ? await options.sources.read(canvas, artboards.map((artboard) => artboard.id)) : new Map<string, string | null>();
        return ok({
          ticketId,
          version,
          shippedAt: now(),
          approvedBy: userName(),
          note: note?.trim() ?? '',
          canvasUrl: canvas?.url ?? null,
          tokensFile: DESIGN_TOKENS_FILE,
          artboards: artboards.map((artboard) => ({ ...artboard, source: sources.get(artboard.id) ?? null })),
          supersedes,
          reshipOf: null,
        });
      }),

    reship: (ticketId, version) =>
      store(ticketId, async (next, supersedes) => {
        const record = await tickets.get(ticketId);
        if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
        if (!record.design.specs.some((entry) => entry.version === version)) return err('VALIDATION', `There is no Design v${version} to ship again.`);
        const earlier = await files.read(record.repo, ticketId, version);
        if (!earlier) return err('INTERNAL', `Design v${version} could not be read from the app data folder.`);
        return ok({ ...earlier, version: next, shippedAt: now(), approvedBy: userName(), supersedes, reshipOf: version });
      }),

    deliverPending,

    dispose: () => {
      unsubscribe();
    },
  };
}
