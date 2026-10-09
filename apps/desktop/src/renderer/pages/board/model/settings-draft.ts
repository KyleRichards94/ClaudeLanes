import {
  DROP_KINDS,
  dropDefaultsOf,
  type DropDefaults,
  type DropKind,
  BUILD_QUEUE_SIZE_LIMIT,
  MAX_CONCURRENT_AGENTS_LIMIT,
  agentPermissionMode,
  agentPermissionPolicy,
  type AgentPermissionMode,
  type AgentPermissions,
  repoAdoWriteBack,
  type Effort,
  type Gate,
  type Model,
  type RepoSettings,
  type Settings,
  type SettingsPatch,
  type Stage,
  type StageGates,
  launchHoldPercentOf,
} from '@agent-lanes/contracts';

/**
 * The settings panel's form (AL-146): what the user has typed, before it is saved. Numbers and
 * lists are kept as the text in their fields, so a half-typed value can be shown with its error.
 * Repo fields are kept only for repos the user has edited; the others show what is saved.
 */
export interface RepoDraft {
  name: string;
  baseBranch: string;
  worktreeRoot: string;
  /** Empty uses the detected command. */
  buildCommand: string;
  runCommand: string;
  maxConcurrentAgents: string;
  adoWriteBack: boolean;
}

export interface SettingsDraft {
  model: Model;
  effort: Effort;
  stageGates: StageGates;
  /** Skill names separated by commas or spaces, with or without the leading slash. */
  skills: string;
  buildQueueSize: string;
  /** The 5-hour share above which launches wait (AL-258), as text. */
  launchHoldPercent: string;
  adoStateTransitions: boolean;
  /** Edited repos by path. */
  repos: Readonly<Record<string, RepoDraft>>;
  /** The headless permission policy (AL-109); `bashAllow` is the text of its field. */
  permissions: PermissionsDraft;
  /** Settings › Drops (AL-240): each kind of drop's skills (as typed), model and effort. */
  drops: Readonly<Record<DropKind, DropDraft>>;
}

export interface DropDraft {
  /** Skill names separated by commas or spaces, with or without the leading slash. */
  skills: string;
  model: Model;
  effort: Effort;
}

export interface PermissionsDraft {
  /** Auto (Claude Code's classifier), Accept edits, or Ask. */
  mode: AgentPermissionMode;
  gitRead: boolean;
  buildAndTest: boolean;
  /** Command prefixes separated by commas. */
  bashAllow: string;
}

export type PermissionSwitch = Exclude<keyof PermissionsDraft, 'bashAllow' | 'mode'>;

export type GlobalTextField = 'skills' | 'buildQueueSize' | 'launchHoldPercent';
export type RepoTextField = Exclude<keyof RepoDraft, 'adoWriteBack'>;

export type DraftAction =
  | { type: 'reset'; settings: Settings }
  | { type: 'model'; model: Model }
  | { type: 'effort'; effort: Effort }
  | { type: 'gate'; stage: Stage; gate: Gate }
  | { type: 'text'; field: GlobalTextField; value: string }
  | { type: 'adoStateTransitions'; value: boolean }
  | { type: 'repoText'; repo: RepoSettings; field: RepoTextField; value: string }
  | { type: 'repoWriteBack'; repo: RepoSettings; value: boolean }
  | { type: 'permission'; field: PermissionSwitch; value: boolean }
  | { type: 'permissionMode'; mode: AgentPermissionMode }
  | { type: 'bashAllow'; value: string }
  | { type: 'drop'; kind: DropKind; change: Partial<DropDraft> };

export function repoDraft(repo: RepoSettings): RepoDraft {
  return {
    name: repo.name,
    baseBranch: repo.baseBranch,
    worktreeRoot: repo.worktreeRoot,
    buildCommand: repo.buildCommand ?? '',
    runCommand: repo.runCommand ?? '',
    maxConcurrentAgents: String(repo.maxConcurrentAgents),
    adoWriteBack: repoAdoWriteBack(repo),
  };
}

export function draftFromSettings(settings: Settings): SettingsDraft {
  return {
    model: settings.defaults.model,
    effort: settings.defaults.effort,
    stageGates: { ...settings.defaults.stageGates },
    skills: settings.defaults.skills.map((skill) => `/${skill}`).join(' '),
    buildQueueSize: String(settings.buildQueueSize),
    launchHoldPercent: String(launchHoldPercentOf(settings)),
    adoStateTransitions: settings.adoStateTransitions,
    repos: {},
    permissions: permissionsDraft(agentPermissionPolicy(settings)),
    drops: dropsDraft(dropDefaultsOf(settings)),
  };
}

function dropsDraft(defaults: DropDefaults): Record<DropKind, DropDraft> {
  return Object.fromEntries(
    DROP_KINDS.map((kind) => [kind, { skills: defaults[kind].skills.map((skill) => `/${skill}`).join(' '), model: defaults[kind].model, effort: defaults[kind].effort }]),
  ) as Record<DropKind, DropDraft>;
}

function permissionsDraft(policy: AgentPermissions): PermissionsDraft {
  return { mode: agentPermissionMode(policy), gitRead: policy.gitRead, buildAndTest: policy.buildAndTest, bashAllow: policy.bashAllow.join(', ') };
}

/** "npm run lint, dotnet format" → ["npm run lint", "dotnet format"], each once. */
export function parseCommandPrefixes(text: string): string[] {
  return [...new Set(text.split(',').map((command) => command.trim()).filter((command) => command.length > 0))];
}

/** The repo as the form shows it: the user's edits, else what is saved. */
export function repoValues(draft: SettingsDraft, repo: RepoSettings): RepoDraft {
  return draft.repos[repo.path] ?? repoDraft(repo);
}

export function draftReducer(draft: SettingsDraft, action: DraftAction): SettingsDraft {
  switch (action.type) {
    case 'reset':
      return draftFromSettings(action.settings);
    case 'model':
      return { ...draft, model: action.model };
    case 'effort':
      return { ...draft, effort: action.effort };
    case 'gate':
      return { ...draft, stageGates: { ...draft.stageGates, [action.stage]: action.gate } };
    case 'text':
      return { ...draft, [action.field]: action.value };
    case 'adoStateTransitions':
      return { ...draft, adoStateTransitions: action.value };
    case 'repoText':
      return { ...draft, repos: { ...draft.repos, [action.repo.path]: { ...repoValues(draft, action.repo), [action.field]: action.value } } };
    case 'repoWriteBack':
      return { ...draft, repos: { ...draft.repos, [action.repo.path]: { ...repoValues(draft, action.repo), adoWriteBack: action.value } } };
    case 'permission':
      return { ...draft, permissions: { ...draft.permissions, [action.field]: action.value } };
    case 'permissionMode':
      return { ...draft, permissions: { ...draft.permissions, mode: action.mode } };
    case 'bashAllow':
      return { ...draft, permissions: { ...draft.permissions, bashAllow: action.value } };
    case 'drop':
      return { ...draft, drops: { ...draft.drops, [action.kind]: { ...draft.drops[action.kind], ...action.change } } };
  }
}

/** "/code-review, cs-qa-wip" → ["code-review", "cs-qa-wip"], each once. */
export function parseSkills(text: string): string[] {
  const names = text
    .split(/[\s,]+/)
    .map((name) => name.replace(/^\/+/, ''))
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}

const SKILL_NAME = /^[A-Za-z0-9][\w.:-]*$/;
/** An absolute Windows (`C:\`, `\\server\`) or POSIX path. */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

function wholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
}

/** Field errors, keyed `buildQueueSize`, `skills`, or `<repo path>:<field>`. Empty when the draft can be saved. */
export type DraftErrors = Readonly<Record<string, string>>;

/** The error key of a drop row's skills field. */
export function dropErrorKey(kind: DropKind): string {
  return `drops:${kind}`;
}

export function repoErrorKey(repo: Pick<RepoSettings, 'path'>, field: RepoTextField): string {
  return `${repo.path}:${field}`;
}

export function validateDraft(draft: SettingsDraft, repos: readonly RepoSettings[]): DraftErrors {
  const errors: Record<string, string> = {};
  if (wholeNumber(draft.buildQueueSize, 1, BUILD_QUEUE_SIZE_LIMIT) === null) {
    errors['buildQueueSize'] = `Enter a whole number from 1 to ${BUILD_QUEUE_SIZE_LIMIT}.`;
  }
  if (wholeNumber(draft.launchHoldPercent, 0, 100) === null) errors['launchHoldPercent'] = 'Enter a whole number from 0 to 100.';
  const badSkill = parseSkills(draft.skills).find((name) => !SKILL_NAME.test(name));
  if (badSkill) errors['skills'] = `"${badSkill}" is not a skill name. Use names like /code-review.`;
  for (const kind of DROP_KINDS) {
    const skills = parseSkills(draft.drops[kind].skills);
    const bad = skills.find((name) => !SKILL_NAME.test(name));
    if (bad) errors[dropErrorKey(kind)] = `"${bad}" is not a skill name. Use names like /code-review.`;
    else if (skills.length > 16) errors[dropErrorKey(kind)] = 'Enter at most 16 skills.';
  }
  const commands = parseCommandPrefixes(draft.permissions.bashAllow);
  const chained = commands.find((command) => /[;&|`$<>]/.test(command));
  if (chained) errors['bashAllow'] = `"${chained}" chains or redirects commands. Enter plain commands such as npm run lint.`;
  else if (commands.some((command) => command.length > 200) || commands.length > 50) errors['bashAllow'] = 'Enter at most 50 commands of up to 200 characters.';

  for (const repo of repos) {
    const values = draft.repos[repo.path];
    if (!values) continue;
    if (!values.name.trim()) errors[repoErrorKey(repo, 'name')] = 'Give the repo a name.';
    if (!values.baseBranch.trim()) errors[repoErrorKey(repo, 'baseBranch')] = 'Enter the branch tickets start from.';
    else if (/\s/.test(values.baseBranch.trim())) errors[repoErrorKey(repo, 'baseBranch')] = 'A branch name has no spaces.';
    if (!ABSOLUTE_PATH.test(values.worktreeRoot.trim())) errors[repoErrorKey(repo, 'worktreeRoot')] = 'Enter a full folder path, such as C:\\src\\.agent-lanes.';
    if (wholeNumber(values.maxConcurrentAgents, 1, MAX_CONCURRENT_AGENTS_LIMIT) === null) {
      errors[repoErrorKey(repo, 'maxConcurrentAgents')] = `Enter a whole number from 1 to ${MAX_CONCURRENT_AGENTS_LIMIT}.`;
    }
  }
  return errors;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function savedRepo(repo: RepoSettings, values: RepoDraft): RepoSettings {
  const next: RepoSettings = {
    ...repo,
    name: values.name.trim(),
    baseBranch: values.baseBranch.trim(),
    worktreeRoot: values.worktreeRoot.trim(),
    buildCommand: values.buildCommand.trim() || null,
    runCommand: values.runCommand.trim() || null,
    maxConcurrentAgents: Number(values.maxConcurrentAgents.trim()),
  };
  // Written only when switched, so a repo that never had the field keeps it unset (off).
  if (values.adoWriteBack !== repoAdoWriteBack(repo)) next.adoWriteBack = values.adoWriteBack;
  return next;
}

function sameRepo(a: RepoSettings, b: RepoSettings): boolean {
  return (
    a.name === b.name &&
    a.baseBranch === b.baseBranch &&
    a.worktreeRoot === b.worktreeRoot &&
    a.buildCommand === b.buildCommand &&
    a.runCommand === b.runCommand &&
    a.maxConcurrentAgents === b.maxConcurrentAgents &&
    repoAdoWriteBack(a) === repoAdoWriteBack(b)
  );
}

/**
 * The `settings:update` patch for a valid draft: only what differs from `settings`, so saving an
 * untouched form changes nothing. Repos are sent whole (D64), and only when one of them changed;
 * repos added or removed since the form opened keep what main holds.
 */
export function draftToPatch(draft: SettingsDraft, settings: Settings): SettingsPatch {
  const patch: SettingsPatch = {};
  const defaults: NonNullable<SettingsPatch['defaults']> = {};
  if (draft.model !== settings.defaults.model) defaults.model = draft.model;
  if (draft.effort !== settings.defaults.effort) defaults.effort = draft.effort;
  if (Object.entries(draft.stageGates).some(([stage, gate]) => settings.defaults.stageGates[stage as Stage] !== gate)) {
    defaults.stageGates = { ...draft.stageGates };
  }
  const skills = parseSkills(draft.skills);
  if (!sameList(skills, settings.defaults.skills)) defaults.skills = skills;
  if (Object.keys(defaults).length > 0) patch.defaults = defaults;

  const buildQueueSize = Number(draft.buildQueueSize.trim());
  if (buildQueueSize !== settings.buildQueueSize) patch.buildQueueSize = buildQueueSize;
  const launchHoldPercent = Number(draft.launchHoldPercent.trim());
  if (launchHoldPercent !== launchHoldPercentOf(settings)) patch.launchHoldPercent = launchHoldPercent;
  if (draft.adoStateTransitions !== settings.adoStateTransitions) patch.adoStateTransitions = draft.adoStateTransitions;
  const policy: AgentPermissions = {
    mode: draft.permissions.mode,
    // Kept in step with the mode for older readers of the settings file.
    edits: draft.permissions.mode === 'ask' ? 'ask' : 'accept',
    gitRead: draft.permissions.gitRead,
    buildAndTest: draft.permissions.buildAndTest,
    bashAllow: parseCommandPrefixes(draft.permissions.bashAllow),
  };
  const saved = agentPermissionPolicy(settings);
  if (draft.permissions.mode !== agentPermissionMode(saved) || policy.gitRead !== saved.gitRead || policy.buildAndTest !== saved.buildAndTest || !sameList(policy.bashAllow, saved.bashAllow)) {
    patch.agentPermissions = policy;
  }

  const savedDrops = dropDefaultsOf(settings);
  const drops = Object.fromEntries(
    DROP_KINDS.map((kind) => [kind, { skills: parseSkills(draft.drops[kind].skills), model: draft.drops[kind].model, effort: draft.drops[kind].effort }]),
  ) as DropDefaults;
  if (DROP_KINDS.some((kind) => !sameList(drops[kind].skills, savedDrops[kind].skills) || drops[kind].model !== savedDrops[kind].model || drops[kind].effort !== savedDrops[kind].effort)) {
    patch.dropDefaults = drops;
  }

  const repos = settings.repos.map((repo) => {
    const values = draft.repos[repo.path];
    return values ? savedRepo(repo, values) : repo;
  });
  if (repos.some((repo, i) => !sameRepo(repo, settings.repos[i] as RepoSettings))) patch.repos = repos;
  return patch;
}

export function isEmptyPatch(patch: SettingsPatch): boolean {
  return Object.keys(patch).length === 0;
}
