import { z } from 'zod';
import type { InvokeContract } from '../contract';
import {
  EffortSchema,
  EmbedModeSchema,
  GateSchema,
  LaneSchema,
  ModelSchema,
  STAGES,
  StageSchema,
  type Gate,
  type Stage,
} from '../vocabulary';
import type { SETTINGS_EVENT_CHANNELS, SETTINGS_INVOKE_CHANNELS } from './settings.names';
import { DropDefaultsSchema } from './settings.drops';

/**
 * App settings (AL-041, design §6, §8, R5): one app-written JSON document in the app data folder,
 * changed only through the UI. The main process owns the file, its version and its migrations
 * (src/main/settings); the renderer reads and patches it over `settings:get` / `settings:update`.
 *
 * Bump SETTINGS_VERSION and add a migration only when a field is renamed, moved or reshaped.
 * A new field needs no migration: give it a default in `defaultSettings()` and the loader fills it in.
 * Keep `.default()` out of these schemas, because zod applies defaults inside `.partial()` and a
 * patch would then overwrite stored values with them.
 */
export const SETTINGS_VERSION = 2;

/** Agents running at once per repo before new launches wait in Queued (AL-111, Q5). */
export const DEFAULT_MAX_CONCURRENT_AGENTS = 3;
export const MAX_CONCURRENT_AGENTS_LIMIT = 16;
/** Builds and runs at once across all worktrees (design §10). */
export const DEFAULT_BUILD_QUEUE_SIZE = 2;
export const BUILD_QUEUE_SIZE_LIMIT = 8;
export const DEFAULT_BASE_BRANCH = 'main';

function unique<T>(items: readonly T[]): boolean {
  return new Set(items).size === items.length;
}

export const RepoSettingsSchema = z.object({
  /** Absolute path of the repo's main checkout. Identifies the repo. */
  path: z.string().min(1),
  /** Name shown in the Repo dropdown; the folder name unless the user renames it. */
  name: z.string().min(1),
  /** Branch tickets start from and merge back into (Q2). */
  baseBranch: z.string().min(1),
  /** Folder that holds this repo's ticket worktrees; `<repo>/../.agent-lanes` by default (§9). */
  worktreeRoot: z.string().min(1),
  /** Build command override; null uses the detected command (§10, AL-130). */
  buildCommand: z.string().min(1).nullable(),
  /** Run command override; null uses the detected command (§10, AL-130). */
  runCommand: z.string().min(1).nullable(),
  maxConcurrentAgents: z.int().min(1).max(MAX_CONCURRENT_AGENTS_LIMIT),
  /**
   * Post a comment to this repo's work items on each stage change (design §7 "ADO write-back",
   * AL-146, AL-115). Opt-in: optional so saved repos stay valid, and leaving it out means off
   * (`repoAdoWriteBack`).
   */
  adoWriteBack: z.boolean().optional(),
});
export type RepoSettings = z.infer<typeof RepoSettingsSchema>;

/** Whether the repo's tickets write stage comments back to ADO; off unless the user turned it on. */
export function repoAdoWriteBack(repo: RepoSettings): boolean {
  return repo.adoWriteBack ?? false;
}

export const ReposSchema = z
  .array(RepoSettingsSchema)
  .refine((repos) => unique(repos.map((repo) => repo.path)), 'Each repo path can be registered once');

/** Every stage with its gate; zod requires all five keys. */
export const StageGatesSchema = z.record(StageSchema, GateSchema);
export type StageGates = z.infer<typeof StageGatesSchema>;

/** What the New agent ticket modal starts with (artboard 2, AL-162–AL-164). */
export const AgentDefaultsSchema = z.object({
  model: ModelSchema,
  effort: EffortSchema,
  stageGates: StageGatesSchema,
  /** Skill names without the leading slash, e.g. `code-review`. */
  skills: z.array(z.string().min(1)).refine(unique, 'Each skill can be listed once'),
});
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;

/** Small UI preferences the renderer keeps in its Zustand persist store (design §6). */
export const UiPrefsSchema = z.object({
  /** Path of the repo the board last showed. */
  lastRepo: z.string().min(1).nullable(),
  /** ADO iteration id of the sprint the board last showed. */
  lastSprint: z.string().min(1).nullable(),
  /**
   * ADO team id the board's Team menu last showed; null follows the user's default team. Settings
   * saved before it load it as null (the loader fills a missing field in from `defaultUiPrefs`).
   */
  lastTeam: z.string().min(1).nullable(),
  collapsedLanes: z.array(LaneSchema).refine(unique, 'Each lane can be listed once'),
  /** Claude Design embed mode per agent ticket id; tickets not listed use the webview (AL-194). */
  embedModeByTicket: z.record(z.string().min(1), EmbedModeSchema),
});
export type UiPrefs = z.infer<typeof UiPrefsSchema>;

/**
 * What a headless agent session may do without asking (AL-109, Decision D18, Q9). Anything else goes
 * through the app's permission prompt ("Needs you · permission" on the card).
 */
export const AgentPermissionsSchema = z.object({
  /** `accept`: file edits in the ticket's worktree go ahead (`acceptEdits`); `ask`: every edit asks too. */
  edits: z.enum(['accept', 'ask']),
  /** Read-only git commands (status, diff, log, show, branch, …). */
  gitRead: z.boolean(),
  /** The repo's build command and its test command (`dotnet test`, `pnpm test`). */
  buildAndTest: z.boolean(),
  /** More Bash command prefixes the agent may run, e.g. `npm run lint`. */
  bashAllow: z.array(z.string().trim().min(1).max(200)).max(50),
});
export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

/** D18: accept edits, git read commands and the repo's build and test commands; everything else asks. */
export function defaultAgentPermissions(): AgentPermissions {
  return { edits: 'accept', gitRead: true, buildAndTest: true, bashAllow: [] };
}

export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  repos: ReposSchema,
  defaults: AgentDefaultsSchema,
  buildQueueSize: z.int().min(1).max(BUILD_QUEUE_SIZE_LIMIT),
  /**
   * Let the app move work items to another state in ADO (AL-063, design §7). Off by default: until
   * the user turns it on (AL-146), only comments are written back.
   */
  adoStateTransitions: z.boolean(),
  ui: UiPrefsSchema,
  /** Headless permission policy (AL-109). Optional so settings saved before it stay valid; unset is the D18 default. */
  agentPermissions: AgentPermissionsSchema.optional(),
  /** Settings › Drops (AL-240): each kind of team board drop's skills, model and effort. Unset is TB§3's (`dropDefaultsOf`). */
  dropDefaults: DropDefaultsSchema.optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** The permission policy in force: the saved one, or the D18 default when none was saved. */
export function agentPermissionPolicy(settings: Pick<Settings, 'agentPermissions'>): AgentPermissions {
  return settings.agentPermissions ?? defaultAgentPermissions();
}

/**
 * `settings:update` request: any top-level section, and any field inside `defaults` and `ui`.
 * Fields given replace the stored value whole (arrays and records included); unknown keys are refused.
 */
export const SettingsPatchSchema = z.strictObject({
  repos: ReposSchema.optional(),
  defaults: z.strictObject(AgentDefaultsSchema.shape).partial().optional(),
  buildQueueSize: SettingsSchema.shape.buildQueueSize.optional(),
  adoStateTransitions: SettingsSchema.shape.adoStateTransitions.optional(),
  agentPermissions: AgentPermissionsSchema.optional(),
  /** Every row at once, as the Drops tab saves them. */
  dropDefaults: DropDefaultsSchema.optional(),
  ui: z.strictObject(UiPrefsSchema.shape).partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/** Planning and Create PR need approval; the rest run on (design §9 step 2, artboard 2). */
export function defaultStageGates(): StageGates {
  const approval: readonly Stage[] = ['planning', 'create-pr'];
  return Object.fromEntries(STAGES.map((stage): [Stage, Gate] => [stage, approval.includes(stage) ? 'approval' : 'auto'])) as StageGates;
}

/** Opus · XHigh as on artboard 2; no skills until the user picks some. */
export function defaultAgentDefaults(): AgentDefaults {
  return { model: 'opus', effort: 'xhigh', stageGates: defaultStageGates(), skills: [] };
}

/** Done starts collapsed into its vertical strip (artboard 1). */
export function defaultUiPrefs(): UiPrefs {
  return { lastRepo: null, lastSprint: null, lastTeam: null, collapsedLanes: ['done'], embedModeByTicket: {} };
}

/** Fresh profile: no repos yet (AL-047 asks for one). */
export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    repos: [],
    defaults: defaultAgentDefaults(),
    buildQueueSize: DEFAULT_BUILD_QUEUE_SIZE,
    adoStateTransitions: false,
    ui: defaultUiPrefs(),
  };
}

export const settingsInvokeContracts = {
  'settings:get': { request: z.undefined(), response: SettingsSchema },
  'settings:update': { request: SettingsPatchSchema, response: SettingsSchema },
} as const satisfies Record<(typeof SETTINGS_INVOKE_CHANNELS)[number], InvokeContract>;

export const settingsEventContracts = {} as const satisfies Record<(typeof SETTINGS_EVENT_CHANNELS)[number], z.ZodType>;
