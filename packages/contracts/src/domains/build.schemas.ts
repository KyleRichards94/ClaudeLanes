import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema } from '../events';
import type { BUILD_EVENT_CHANNELS, BUILD_INVOKE_CHANNELS } from './build.names';

// ── Job queue (AL-131, design §10) ───────────────────────────────────────────────────────────────

/** What a queued job does in its worktree: a build (AL-132) or the build step of a run (AL-133). */
export const BUILD_JOB_KINDS = ['build', 'run'] as const;
export const BuildJobKindSchema = z.enum(BUILD_JOB_KINDS);
export type BuildJobKind = z.infer<typeof BuildJobKindSchema>;

/**
 * Where a job is in the queue. `queued` waits for a free slot or for its worktree; `running` holds
 * both; `finished` and `cancelled` are final. Whether a build passed is the build's own result
 * (AL-132), not a queue state.
 */
export const BUILD_JOB_STATES = ['queued', 'running', 'finished', 'cancelled'] as const;
export const BuildJobStateSchema = z.enum(BUILD_JOB_STATES);
export type BuildJobState = z.infer<typeof BuildJobStateSchema>;

/** Milliseconds since the Unix epoch (`Date.now()`). */
const EpochMsSchema = z.number().int().nonnegative();

/** One job as the renderer sees it. The worktree path stays in main; the ticket id identifies it. */
export const BuildJobSchema = z.object({
  jobId: z.string().min(1),
  ticketId: z.string().min(1),
  kind: BuildJobKindSchema,
  state: BuildJobStateSchema,
  /** 1-based place among waiting jobs (1 = next to start when it can); null once it left the queue. */
  position: z.number().int().positive().nullable(),
  queuedAt: EpochMsSchema,
  startedAt: EpochMsSchema.nullable(),
  finishedAt: EpochMsSchema.nullable(),
});
export type BuildJob = z.infer<typeof BuildJobSchema>;

/** `build:listJobs`: the waiting and running jobs, running first, then in queue order. */
export const BuildQueueSchema = z.object({
  /** Jobs allowed to run at once (settings "build queue size", 2 by default). */
  concurrency: z.number().int().positive(),
  jobs: z.array(BuildJobSchema),
});
export type BuildQueue = z.infer<typeof BuildQueueSchema>;

/** `build:cancel`: removes a waiting job, or stops a running one. */
export const CancelBuildJobRequestSchema = z.object({ jobId: z.string().min(1) });
export type CancelBuildJobRequest = z.infer<typeof CancelBuildJobRequestSchema>;

/** False when the job is unknown or already final. */
export const CancelBuildJobResponseSchema = z.object({ cancelled: z.boolean() });
export type CancelBuildJobResponse = z.infer<typeof CancelBuildJobResponseSchema>;

/**
 * `build:queued`: a job's queue status changed. Sent when it is queued (with its position), when
 * its position moves, when it starts, and when it finishes or is cancelled, so the card and the
 * Worktree panel can show "Queued" and clear it again from one channel.
 */
export const BuildQueuedEventSchema = BuildJobSchema.extend({
  /** When main raised the event (`Date.now()`). */
  at: EpochMsSchema,
});
export type BuildQueuedEvent = z.infer<typeof BuildQueuedEventSchema>;

export const buildInvokeContracts = {
  'build:listJobs': { request: z.undefined(), response: BuildQueueSchema },
  'build:cancel': { request: CancelBuildJobRequestSchema, response: CancelBuildJobResponseSchema },
} as const satisfies Record<(typeof BUILD_INVOKE_CHANNELS)[number], InvokeContract>;

// ── Live events (AL-012 envelope; the owning tickets add their fields) ─────────────────────────

/** `build:log`: a batch of output lines from the ticket's build job (AL-132). */
export const BuildLogEventSchema = TicketEventEnvelopeSchema.extend({});
export type BuildLogEvent = z.infer<typeof BuildLogEventSchema>;

/** `run:status`: the ticket's run job started, found its URL, or stopped (AL-133, AL-134). */
export const RunStatusEventSchema = TicketEventEnvelopeSchema.extend({});
export type RunStatusEvent = z.infer<typeof RunStatusEventSchema>;

export const buildEventContracts = {
  'build:log': BuildLogEventSchema,
  'run:status': RunStatusEventSchema,
  'build:queued': BuildQueuedEventSchema,
} as const satisfies Record<(typeof BUILD_EVENT_CHANNELS)[number], z.ZodType>;
