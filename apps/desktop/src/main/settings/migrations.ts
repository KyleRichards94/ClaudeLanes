import { z } from 'zod';
import {
  EffortSchema,
  LaneSchema,
  ModelSchema,
  SETTINGS_VERSION,
  STAGES,
  StageSchema,
  type Gate,
  type Stage,
} from '@agent-lanes/contracts';
import { createRepoSettings } from './repo-settings';

/**
 * Settings migrations. `MIGRATIONS[n]` turns a version n-1 document into a version n document.
 * A migration only reshapes what it finds; values it cannot carry over are left out, and the loader
 * fills them from the defaults of the current version. Older schemas below are frozen copies: never
 * edit them, add a new version instead.
 */
type Migration = (previous: unknown) => unknown;

/** Read a field leniently: a missing or invalid value becomes undefined instead of failing the file. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

/**
 * Version 1: the flat, prefs-only shape design §6 first listed (last repo, collapsed lanes, default
 * model/effort, stage-gate defaults), with gates kept as the list of stages that need approval.
 * Version 2 (AL-041) nests these under `ui` and `defaults` and adds repos, skills, the build queue
 * size, last sprint and the embed mode per ticket.
 */
export const SettingsV1Schema = z.object({
  version: z.literal(1),
  lastRepo: lenient(z.string().min(1).nullable()),
  collapsedLanes: lenient(z.array(LaneSchema)),
  defaultModel: lenient(ModelSchema),
  defaultEffort: lenient(EffortSchema),
  gatedStages: lenient(z.array(StageSchema)),
});
export type SettingsV1 = z.infer<typeof SettingsV1Schema>;

function gatesFromList(gated: readonly Stage[]): Record<Stage, Gate> {
  return Object.fromEntries(STAGES.map((stage): [Stage, Gate] => [stage, gated.includes(stage) ? 'approval' : 'auto'])) as Record<
    Stage,
    Gate
  >;
}

/** v1 → v2: nest the prefs, turn the gated-stage list into a gate per stage, and register the last repo. */
function v1ToV2(previous: unknown): unknown {
  const v1 = SettingsV1Schema.parse(previous);
  return {
    version: 2,
    repos: v1.lastRepo ? [createRepoSettings(v1.lastRepo)] : [],
    defaults: {
      model: v1.defaultModel,
      effort: v1.defaultEffort,
      stageGates: v1.gatedStages && gatesFromList(v1.gatedStages),
    },
    ui: {
      lastRepo: v1.lastRepo,
      collapsedLanes: v1.collapsedLanes,
    },
  };
}

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  2: v1ToV2,
};

/** The document's version, or undefined when it has none or it is not a positive integer. */
export function readVersion(document: Record<string, unknown>): number | undefined {
  const version = document['version'];
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : undefined;
}

/** Runs every migration from `fromVersion` up to SETTINGS_VERSION, in order. */
export function migrateSettings(document: unknown, fromVersion: number): unknown {
  let migrated = document;
  for (let version = fromVersion + 1; version <= SETTINGS_VERSION; version += 1) {
    const migration = MIGRATIONS[version];
    if (!migration) throw new Error(`No settings migration from version ${version - 1} to ${version}`);
    migrated = migration(migrated);
  }
  return migrated;
}
