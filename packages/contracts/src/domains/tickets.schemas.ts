import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketIdSchema } from '../events';
import { EffortSchema, LaneSchema, ModelSchema } from '../vocabulary';
import { BuildDiagnosticSchema } from './build.schemas';
import { DesignCanvasRefSchema } from './design.canvas';
import { StageGatesSchema } from './settings.schemas';
import type { TICKETS_EVENT_CHANNELS, TICKETS_INVOKE_CHANNELS } from './tickets.names';

// ── Ticket records (AL-101, design §6, R2, Decision D8) ───────────────────────────────────────────

/**
 * Everything the app must remember about one agent ticket to rebuild its card after a restart
 * (AL-090) and resume its session (AL-110). The main process writes it as app-owned JSON in
 * `<userData>/tickets/<repoKey>/<ticketId>.json`, never inside the worktree (D8), and reads it back
 * through this schema. Live, high-rate state (output, activity line, progress) stays in memory.
 *
 * Bump TICKET_RECORD_VERSION only when a field is renamed, moved or reshaped; the store refuses to
 * read or overwrite a record from a newer version.
 */
export const TICKET_RECORD_VERSION = 1;

/** Caps that keep one record small enough to rewrite on every change. */
export const TICKET_RECORD_LIMITS = {
  /** Oldest entries are dropped first; the current stage is always the last entry. */
  stageHistory: 200,
  subBranches: 64,
  skills: 64,
  designSpecs: 200,
} as const;

/** Milliseconds since the Unix epoch (`Date.now()`), as in events (D36). */
const EpochMsSchema = z.int().nonnegative();
/** An absolute path on this machine. The main process checks it is absolute for its platform. */
const LocalPathSchema = z.string().min(1).max(4096);
const BranchNameSchema = z.string().min(1).max(255);

function unique<T>(items: readonly T[]): boolean {
  return new Set(items).size === items.length;
}

/** The Azure DevOps work item a ticket works on; null for a "No ticket" ticket (artboard 2). */
export const TicketAdoRefSchema = z.object({
  /** Organisation URL as saved in Connections, e.g. `https://dev.azure.com/contoso`; picks the PAT. */
  orgUrl: z.string().min(1).max(2048),
  project: z.string().min(1).max(256),
  workItemId: z.int().min(1).max(2_147_483_647),
});
export type TicketAdoRef = z.infer<typeof TicketAdoRefSchema>;

/** The ticket entered `stage` at `at`. Stages can repeat: Code review and QA may send work back (§9). */
export const TicketStageEntrySchema = z.object({
  stage: LaneSchema,
  at: EpochMsSchema,
});
export type TicketStageEntry = z.infer<typeof TicketStageEntrySchema>;

/** A writer sub-agent's branch and worktree (AL-084, design §9 step 3). */
export const TicketSubBranchSchema = z.object({
  /** The sub-agent's name, as the SDK's WorktreeCreate hook passed it. */
  name: z.string().min(1).max(200),
  /** `sub/<ticket-id>-<slug>` (AL-082). */
  branch: BranchNameSchema,
  worktreePath: LocalPathSchema,
  createdAt: EpochMsSchema,
  /** When Merge sub-branches merged it into the ticket branch (AL-086); null until then. */
  mergedAt: EpochMsSchema.nullable(),
});
export type TicketSubBranch = z.infer<typeof TicketSubBranchSchema>;

export const TICKET_BUILD_OUTCOMES = ['succeeded', 'failed', 'cancelled'] as const;
export const TicketBuildOutcomeSchema = z.enum(TICKET_BUILD_OUTCOMES);
export type TicketBuildOutcome = z.infer<typeof TicketBuildOutcomeSchema>;

/** The ticket's last finished build (AL-132): "Build failed · 3 errors" on the card. */
export const TicketLastBuildSchema = z.object({
  outcome: TicketBuildOutcomeSchema,
  startedAt: EpochMsSchema,
  finishedAt: EpochMsSchema,
  errors: z.int().nonnegative(),
  warnings: z.int().nonnegative(),
  /** The first error, the card's activity after a failed build (AL-132); null or absent without one (older records lack it). */
  firstError: BuildDiagnosticSchema.nullable().optional(),
});
export type TicketLastBuild = z.infer<typeof TicketLastBuildSchema>;

/** The ticket's last run (AL-133, AL-134). Closing the app stops every run, so a restart shows it stopped. */
export const TicketLastRunSchema = z.object({
  startedAt: EpochMsSchema,
  /** Null while it runs. */
  stoppedAt: EpochMsSchema.nullable(),
  /** Null while it runs, or when the process tree was killed. */
  exitCode: z.int().nullable(),
  /** "Running · localhost:5080" for a web project; null for a desktop exe. */
  url: z.string().min(1).max(2048).nullable(),
});
export type TicketLastRun = z.infer<typeof TicketLastRunSchema>;

/**
 * One shipped DesignSpec version (AL-197, AL-199). The spec's content is stored next to the record
 * by AL-197; the record keeps the version list so "Design v2" and Sent / Used / Superseded survive
 * a restart (a version is superseded when a later one exists).
 */
export const TicketDesignSpecSchema = z.object({
  version: z.int().min(1),
  shippedAt: EpochMsSchema,
  /** "Design v2 approved by Kyle". */
  approvedBy: z.string().min(1).max(200),
  artboardCount: z.int().nonnegative(),
  /** When the agent acknowledged it with `ack_design_spec` ("Used · 14:01", AL-198); null until then. */
  usedAt: EpochMsSchema.nullable(),
});
export type TicketDesignSpec = z.infer<typeof TicketDesignSpecSchema>;

/** The ticket's Claude Design canvas and shipped specs (E11). */
export const TicketDesignSchema = z.object({
  /** The linked canvas (AL-193); null until the user links one. */
  canvas: DesignCanvasRefSchema.nullable(),
  /** The last URL the view showed (artboard, zoom), so a reopened canvas lands where the user left it (AL-190). */
  lastViewUrl: z.string().max(4096).startsWith('https://claude.ai/').nullable(),
  /** Oldest first; versions strictly increase. */
  specs: z
    .array(TicketDesignSpecSchema)
    .max(TICKET_RECORD_LIMITS.designSpecs)
    .refine((specs) => specs.every((spec, i) => i === 0 || spec.version > (specs[i - 1]?.version ?? 0)), 'Spec versions must increase'),
});
export type TicketDesign = z.infer<typeof TicketDesignSchema>;

export const TicketRecordSchema = z
  .object({
    version: z.literal(TICKET_RECORD_VERSION),
    /** Also the file name and the worktree folder name (AL-082). Never changes. */
    id: TicketIdSchema,
    /** Card title: the work item title, or the start of the job description for a "No ticket" ticket. */
    title: z.string().max(1000),
    ado: TicketAdoRefSchema.nullable(),
    /** Absolute path of the repo's main checkout, as registered in settings (D63). Never changes. */
    repo: LocalPathSchema,
    /** Branch the ticket started from and merges back into (Q2). */
    baseBranch: BranchNameSchema,
    /** The ticket branch, e.g. `71273-cutover-frmjobcontrol-to` (AL-082). */
    branch: BranchNameSchema,
    /** The ticket worktree (AL-083), e.g. `C:\src\.agent-lanes\71273`. The record is never written inside it. */
    worktreePath: LocalPathSchema,
    subBranches: z
      .array(TicketSubBranchSchema)
      .max(TICKET_RECORD_LIMITS.subBranches)
      .refine((subs) => unique(subs.map((sub) => sub.branch)), 'Each sub-branch can be listed once'),
    /** The board lane the card is in. */
    stage: LaneSchema,
    /** When the ticket entered each stage, oldest first; the last entry is the current stage. */
    stageHistory: z.array(TicketStageEntrySchema).min(1).max(TICKET_RECORD_LIMITS.stageHistory),
    /** Planning and Create PR need approval by default (design §9 step 2); editable per ticket. */
    gates: StageGatesSchema,
    model: ModelSchema,
    effort: EffortSchema,
    /** Skill names without the leading slash, e.g. `code-review` (artboard 2). */
    skills: z
      .array(z.string().min(1).max(200))
      .max(TICKET_RECORD_LIMITS.skills)
      .refine(unique, 'Each skill can be listed once'),
    /** The Agent SDK session id, for `resume` after a restart or a lost session (AL-110); null before the first turn. */
    sessionId: z.string().min(1).max(200).nullable(),
    lastBuild: TicketLastBuildSchema.nullable(),
    lastRun: TicketLastRunSchema.nullable(),
    design: TicketDesignSchema,
    createdAt: EpochMsSchema,
    updatedAt: EpochMsSchema,
  })
  .refine((record) => record.stageHistory.at(-1)?.stage === record.stage, {
    message: 'The last stage history entry must be the current stage',
    path: ['stageHistory'],
  });
export type TicketRecord = z.infer<typeof TicketRecordSchema>;

/** `tickets:list`: every ticket record, oldest first, so the board shows its cards after a start (AL-143; AL-090 reconciles them). */
export const TicketRecordListSchema = z.array(TicketRecordSchema);

export const ticketsInvokeContracts = {
  'tickets:list': { request: z.undefined(), response: TicketRecordListSchema },
} as const satisfies Record<(typeof TICKETS_INVOKE_CHANNELS)[number], InvokeContract>;

export const ticketsEventContracts = {} as const satisfies Record<(typeof TICKETS_EVENT_CHANNELS)[number], z.ZodType>;
