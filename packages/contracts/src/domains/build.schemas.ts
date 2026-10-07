import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema } from '../events';
import type { BUILD_EVENT_CHANNELS, BUILD_INVOKE_CHANNELS } from './build.names';
import type { RepoSettings } from './settings.schemas';

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

// ── Build and run commands (AL-130, design §10) ──────────────────────────────────────────────────
//
// Detected per repo from its files; the repo's `buildCommand` / `runCommand` settings override them
// (D63, edited in AL-146), never a file in the repo (R5).

/** The toolchain the detected commands use. AL-133 picks the port variable from it (`ASPNETCORE_URLS` / `PORT`). */
export const BUILD_TOOLCHAINS = ['dotnet', 'node'] as const;
export const BuildToolchainSchema = z.enum(BUILD_TOOLCHAINS);
export type BuildToolchain = z.infer<typeof BuildToolchainSchema>;

/** Node package managers: package.json's `packageManager` field, else the lockfile, else npm. */
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export const PackageManagerSchema = z.enum(PACKAGE_MANAGERS);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

/**
 * What the detected run command starts: a web project (gets a free port, AL-133), a desktop app
 * that opens its own window, a console app, or a package.json script.
 */
export const RUN_TARGET_KINDS = ['web', 'desktop', 'console', 'script'] as const;
export const RunTargetKindSchema = z.enum(RUN_TARGET_KINDS);
export type RunTargetKind = z.infer<typeof RunTargetKindSchema>;

/**
 * Commands found in a folder (the repo's main checkout or a ticket worktree). Command lines quote
 * paths with spaces and use forward slashes, so they run the same in cmd.exe and a POSIX shell.
 */
export const DetectedCommandsSchema = z.object({
  toolchain: BuildToolchainSchema,
  /** File the commands come from, relative to the folder with forward slashes: `OnSite.sln`, `App/App.csproj`, `package.json`. */
  manifest: z.string().min(1),
  /** The package manager for node; null for dotnet. */
  packageManager: PackageManagerSchema.nullable(),
  /** e.g. `dotnet build OnSite.sln -c Debug`, `pnpm run build`; null when there is none. */
  build: z.string().min(1).nullable(),
  /** e.g. `dotnet run --project App/App.csproj`, `pnpm run start`; null when there is none. */
  run: z.string().min(1).nullable(),
  /** What `run` starts: the project's relative path (dotnet) or the script name (node); null without a run command. */
  runTarget: z.string().min(1).nullable(),
  runKind: RunTargetKindSchema.nullable(),
});
export type DetectedCommands = z.infer<typeof DetectedCommandsSchema>;

/** Where an effective command comes from. */
export const COMMAND_ORIGINS = ['override', 'detected'] as const;
export const CommandOriginSchema = z.enum(COMMAND_ORIGINS);
export type CommandOrigin = z.infer<typeof CommandOriginSchema>;

export const RepoCommandSchema = z.object({
  /** The command line Build or Run runs in the ticket's worktree. */
  command: z.string().min(1),
  /** `override`: the repo's setting; `detected`: found in the repo's files. */
  origin: CommandOriginSchema,
});
export type RepoCommand = z.infer<typeof RepoCommandSchema>;

/** `build:commands` request: a registered repo's path (compared without case on Windows). */
export const RepoCommandsRequestSchema = z.strictObject({ repoPath: z.string().min(1) });
export type RepoCommandsRequest = z.infer<typeof RepoCommandsRequestSchema>;

/** A repo's build and run commands: its override where set, else what was detected. */
export const RepoCommandsSchema = z.object({
  /** The registered repo's path, as stored in settings. */
  repoPath: z.string().min(1),
  /** What the repo's files give, shown beside the override fields (AL-146); null when nothing was found. */
  detected: DetectedCommandsSchema.nullable(),
  /** The command Build runs; null when there is neither an override nor a detected command. */
  build: RepoCommandSchema.nullable(),
  /** The command Run starts; null when there is neither an override nor a detected command. */
  run: RepoCommandSchema.nullable(),
});
export type RepoCommands = z.infer<typeof RepoCommandsSchema>;

/** A blank override (whitespace only) counts as unset, so clearing the field falls back to the detected command. */
function overrideCommand(value: string | null): string | null {
  return value?.trim() || null;
}

/**
 * The commands Build and Run use for a repo: its override where one is set, else the detected command
 * (D63). Pure, so the settings panel (AL-146) can show the effect of an edit before saving it.
 */
export function resolveRepoCommands(
  repo: Pick<RepoSettings, 'path' | 'buildCommand' | 'runCommand'>,
  detected: DetectedCommands | null,
): RepoCommands {
  const pick = (override: string | null, found: string | null | undefined): RepoCommand | null => {
    const command = overrideCommand(override);
    if (command) return { command, origin: 'override' };
    return found ? { command: found, origin: 'detected' } : null;
  };
  return {
    repoPath: repo.path,
    detected,
    build: pick(repo.buildCommand, detected?.build),
    run: pick(repo.runCommand, detected?.run),
  };
}

export const buildInvokeContracts = {
  'build:listJobs': { request: z.undefined(), response: BuildQueueSchema },
  'build:cancel': { request: CancelBuildJobRequestSchema, response: CancelBuildJobResponseSchema },
  /** Detects the repo's commands from its main checkout and applies its overrides (AL-130). */
  'build:commands': { request: RepoCommandsRequestSchema, response: RepoCommandsSchema },
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
