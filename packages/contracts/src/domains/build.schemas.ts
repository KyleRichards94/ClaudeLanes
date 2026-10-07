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

// ── Build jobs and their log (AL-132, design §10, artboard 6 "Build failed") ─────────────────────

/** How a log line reads: a compiler error or warning, or anything else. The Build log tab colours it (AL-135). */
export const BUILD_LOG_LEVELS = ['info', 'warning', 'error'] as const;
export const BuildLogLevelSchema = z.enum(BUILD_LOG_LEVELS);
export type BuildLogLevel = z.infer<typeof BuildLogLevelSchema>;

export const BUILD_LOG_STREAMS = ['stdout', 'stderr'] as const;
export const BuildLogStreamSchema = z.enum(BUILD_LOG_STREAMS);
export type BuildLogStream = z.infer<typeof BuildLogStreamSchema>;

/** Longest log line sent; longer lines are cut and end in `…`. */
export const BUILD_LOG_LINE_MAX = 4_000;
/** Most lines in one `build:log` batch. */
export const BUILD_LOG_BATCH_MAX = 500;
/** Most diagnostics a build result carries; the counts still count them all. */
export const BUILD_DIAGNOSTICS_MAX = 200;

export const BuildLogLineSchema = z.object({
  /** The line without its line break or terminal colour codes. */
  text: z.string().max(BUILD_LOG_LINE_MAX),
  stream: BuildLogStreamSchema,
  level: BuildLogLevelSchema,
});
export type BuildLogLine = z.infer<typeof BuildLogLineSchema>;

export const BUILD_DIAGNOSTIC_SEVERITIES = ['error', 'warning'] as const;
export const BuildDiagnosticSeveritySchema = z.enum(BUILD_DIAGNOSTIC_SEVERITIES);
export type BuildDiagnosticSeverity = z.infer<typeof BuildDiagnosticSeveritySchema>;

/** One compiler or linter message read off the log (MSBuild, tsc or eslint formats). */
export const BuildDiagnosticSchema = z.object({
  severity: BuildDiagnosticSeveritySchema,
  /** `CS0246`, `TS2322`, `MSB3027`, an eslint rule such as `no-unused-vars`; null when the tool gave none. */
  code: z.string().min(1).max(200).nullable(),
  message: z.string().min(1).max(BUILD_LOG_LINE_MAX),
  /** The file as the tool printed it; null for tool-wide messages. */
  file: z.string().min(1).max(4096).nullable(),
  line: z.int().positive().nullable(),
  column: z.int().positive().nullable(),
});
export type BuildDiagnostic = z.infer<typeof BuildDiagnosticSchema>;

export const BUILD_OUTCOMES = ['succeeded', 'failed', 'cancelled'] as const;
export const BuildOutcomeSchema = z.enum(BUILD_OUTCOMES);
export type BuildOutcome = z.infer<typeof BuildOutcomeSchema>;

/** A finished build: `build:start`'s data (or the BUILD_FAILED details) and the `build:finished` event. */
export const BuildResultSchema = z.object({
  jobId: z.string().min(1),
  ticketId: z.string().min(1),
  kind: BuildJobKindSchema,
  outcome: BuildOutcomeSchema,
  /** The command line that ran. */
  command: z.string().min(1),
  /** Null when the process was killed or never started. */
  exitCode: z.int().nullable(),
  /** Distinct errors and warnings (MSBuild prints each twice; each is counted once). */
  errors: z.int().nonnegative(),
  warnings: z.int().nonnegative(),
  /** Errors first, each group in log order, at most BUILD_DIAGNOSTICS_MAX. */
  diagnostics: z.array(BuildDiagnosticSchema).max(BUILD_DIAGNOSTICS_MAX),
  startedAt: EpochMsSchema,
  finishedAt: EpochMsSchema,
});
export type BuildResult = z.infer<typeof BuildResultSchema>;

/** `build:start`: build the ticket's worktree with its repo's build command. */
export const StartBuildRequestSchema = z.strictObject({ ticketId: z.string().min(1) });
export type StartBuildRequest = z.infer<typeof StartBuildRequestSchema>;

// ── Run jobs (AL-133, AL-134, design §10 Run and Stop) ─────────────────────────────────────────────

/**
 * Where a ticket's run is: `building` (its build step, when the last build is stale), `starting`
 * (process up, a web project's URL not seen yet), `running`, `stopping`, then `stopped` (it exited or
 * was stopped) or `failed` (the build failed, it could not start, or it exited with an error).
 */
export const RUN_STATES = ['building', 'starting', 'running', 'stopping', 'stopped', 'failed'] as const;
export const RunStateSchema = z.enum(RUN_STATES);
export type RunState = z.infer<typeof RunStateSchema>;

/** A run that is still going (Stop applies); the others are final. */
export const ACTIVE_RUN_STATES: readonly RunState[] = ['building', 'starting', 'running', 'stopping'];

export const RunStatusSchema = z.object({
  ticketId: z.string().min(1),
  runId: z.string().min(1),
  state: RunStateSchema,
  /** What the run command starts (AL-130); null for an override the app could not classify. */
  runKind: RunTargetKindSchema.nullable(),
  /** The free port given to a web project (`ASPNETCORE_URLS` / `PORT`); null for desktop and console apps. */
  port: z.int().min(1).max(65_535).nullable(),
  /** Where the app listens, e.g. `http://localhost:5080/`; null until seen, and for desktop apps. */
  url: z.string().min(1).max(2048).nullable(),
  startedAt: EpochMsSchema,
  /** Null while it runs. */
  stoppedAt: EpochMsSchema.nullable(),
  /** Null while it runs, or when it was killed. */
  exitCode: z.int().nullable(),
  /** Why it failed or stopped, e.g. "Build failed · 3 errors"; null otherwise. */
  message: z.string().max(1000).nullable(),
});
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunTicketRequestSchema = z.strictObject({ ticketId: z.string().min(1) });
export type RunTicketRequest = z.infer<typeof RunTicketRequestSchema>;

/** `run:list`: every run started since the app opened, newest status per ticket. */
export const RunListSchema = z.object({ runs: z.array(RunStatusSchema) });
export type RunList = z.infer<typeof RunListSchema>;

/** `run:openUrl`: false when the ticket has no running web app with a URL. */
export const OpenRunUrlResponseSchema = z.object({ opened: z.boolean() });
export type OpenRunUrlResponse = z.infer<typeof OpenRunUrlResponseSchema>;

export const buildInvokeContracts = {
  /**
   * Runs the ticket's app: builds first when the last build is stale, then starts the run command in
   * its worktree; a web project gets a free port. Resolves once the process started (state
   * `starting` or `running`); BUILD_FAILED when the build step failed; VALIDATION when the ticket, its
   * worktree or a run command is missing. A ticket that is already running returns its status (AL-133).
   */
  'run:start': { request: RunTicketRequestSchema, response: RunStatusSchema },
  'run:list': { request: z.undefined(), response: RunListSchema },
  /** Opens the ticket's running web app in the default browser ("Running · localhost:5080" click). */
  'run:openUrl': { request: RunTicketRequestSchema, response: OpenRunUrlResponseSchema },
  /**
   * Queues a build of the ticket's worktree and settles when it ends: ok with the result when it
   * succeeded or was cancelled, BUILD_FAILED with the result as `details` when it failed, VALIDATION
   * for an unknown ticket or a repo without a build command (AL-132).
   */
  'build:start': { request: StartBuildRequestSchema, response: BuildResultSchema },
  'build:listJobs': { request: z.undefined(), response: BuildQueueSchema },
  'build:cancel': { request: CancelBuildJobRequestSchema, response: CancelBuildJobResponseSchema },
  /** Detects the repo's commands from its main checkout and applies its overrides (AL-130). */
  'build:commands': { request: RepoCommandsRequestSchema, response: RepoCommandsSchema },
} as const satisfies Record<(typeof BUILD_INVOKE_CHANNELS)[number], InvokeContract>;

// ── Live events (AL-012 envelope; the owning tickets add their fields) ─────────────────────────

/** `build:log`: a batch of output lines from one of the ticket's jobs, sent about every 100 ms (AL-132). */
export const BuildLogEventSchema = TicketEventEnvelopeSchema.extend({
  jobId: z.string().min(1),
  kind: BuildJobKindSchema,
  lines: z.array(BuildLogLineSchema).min(1).max(BUILD_LOG_BATCH_MAX),
});
export type BuildLogEvent = z.infer<typeof BuildLogEventSchema>;

/** `run:status`: the ticket's run job changed state, found its URL, or stopped (AL-133, AL-134). */
export const RunStatusEventSchema = RunStatusSchema.extend(TicketEventEnvelopeSchema.shape);
export type RunStatusEvent = z.infer<typeof RunStatusEventSchema>;

/** `build:finished`: a build ended; the card shows "Build failed · 3 errors" and the first error (AL-132). */
export const BuildFinishedEventSchema = BuildResultSchema.extend(TicketEventEnvelopeSchema.shape);
export type BuildFinishedEvent = z.infer<typeof BuildFinishedEventSchema>;

export const buildEventContracts = {
  'build:log': BuildLogEventSchema,
  'build:finished': BuildFinishedEventSchema,
  'run:status': RunStatusEventSchema,
  'build:queued': BuildQueuedEventSchema,
} as const satisfies Record<(typeof BUILD_EVENT_CHANNELS)[number], z.ZodType>;
