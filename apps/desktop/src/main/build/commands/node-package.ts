import { PACKAGE_MANAGERS, type PackageManager } from '@agent-lanes/contracts';
import { commandLine } from './command-line';

/** Lockfiles in the order they are trusted when several are committed; a stray package-lock.json is the usual extra. */
const LOCKFILES: ReadonlyArray<readonly [file: string, manager: PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

/** Corepack's `packageManager` field: `pnpm@10.34.6`, `yarn@4.5.0+sha512.…`. */
export function packageManagerFromField(field: unknown): PackageManager | null {
  if (typeof field !== 'string') return null;
  const name = field.trim().split('@')[0]?.toLowerCase();
  return PACKAGE_MANAGERS.find((manager) => manager === name) ?? null;
}

/** The package manager a lockfile belongs to; `fileNames` are the folder's entries (compared without case). */
export function packageManagerFromLockfiles(fileNames: Iterable<string>): PackageManager | null {
  const present = new Set([...fileNames].map((name) => name.toLowerCase()));
  return LOCKFILES.find(([file]) => present.has(file))?.[1] ?? null;
}

export interface NodeCommands {
  build: string | null;
  run: string | null;
  /** The script `run` starts. */
  runScript: string | null;
}

/** Scripts tried for Run, in order (design §10: "its build / start scripts"; `dev` when there is no `start`). */
const RUN_SCRIPTS = ['start', 'dev'] as const;

function scripts(pkg: unknown): Record<string, unknown> {
  if (typeof pkg !== 'object' || pkg === null) return {};
  const value = (pkg as { scripts?: unknown }).scripts;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hasScript(all: Record<string, unknown>, name: string): boolean {
  const script = Object.hasOwn(all, name) ? all[name] : undefined;
  return typeof script === 'string' && script.trim() !== '';
}

/** `<manager> run build` and `<manager> run start` (or `dev`) from a parsed package.json. */
export function nodeCommands(pkg: unknown, manager: PackageManager): NodeCommands {
  const all = scripts(pkg);
  const runScript = RUN_SCRIPTS.find((name) => hasScript(all, name)) ?? null;
  return {
    build: hasScript(all, 'build') ? commandLine([manager, 'run', 'build']) : null,
    run: runScript ? commandLine([manager, 'run', runScript]) : null,
    runScript,
  };
}
