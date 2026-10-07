import type { LoggedProblem } from '@agent-lanes/contracts';
import { createRedactor, type Redactor } from './redact';
import { createRotatingFile } from './rotating-file';

/**
 * The main-process log (AL-214): `<userData>/logs/main.log`, rotated by size, every line redacted
 * before it reaches the disk, the console or diagnostics. One logger is created at start-up and each
 * service gets a `child(scope)` so lines say where they came from:
 *
 *   2026-10-07T01:02:03.456Z ERROR [ipc] ado:listSprints failed: request failed
 *     Error: request failed
 *         at …
 *
 * Log errors and lifecycle (start, stop, child processes), not agent output or build logs: those
 * have their own transcript and build log.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Under the app data folder (`app.getPath('userData')`). */
export const LOG_DIRECTORY_NAME = 'logs';
export const LOG_FILE_NAME = 'main.log';

const MAX_MESSAGE_CHARS = 8_000;
const MAX_DETAIL_CHARS = 20_000;
/** Recent problems keep a shorter detail: diagnostics are pasted into chats and tickets. */
const MAX_PROBLEM_DETAIL_CHARS = 4_000;
const DEFAULT_RECENT_LIMIT = 50;
const MAX_CAUSE_DEPTH = 3;

/**
 * Marks a console method that `captureConsole` replaced, pointing at the one it replaced. The logger
 * mirrors through the original so a mirrored line is not captured and logged a second time.
 */
export const ORIGINAL_CONSOLE_METHOD = Symbol.for('agent-lanes.original-console-method');

export interface ConsoleLike {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface Logger {
  /** What this logger's lines are tagged with: `main`, `ipc`, `secrets`, `renderer`, … */
  readonly scope: string;
  /** Folder holding the current file and its rotated copies. */
  readonly directory: string;
  /** The file being written now. */
  readonly filePath: string;
  /** Shared by every child; register a secret here and no line will contain it. */
  readonly redactor: Redactor;
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
  log(level: LogLevel, message: string, detail?: unknown): void;
  /** Same file, redactor and history under another scope. `mirror: false` keeps its lines off the console. */
  child(scope: string, options?: { mirror?: boolean }): Logger;
  /** The latest warnings and errors, oldest first, already redacted. */
  recentProblems(): LoggedProblem[];
  /** Every file this log may use, newest first (some may not exist yet). */
  files(): string[];
}

export interface LoggerOptions {
  directory: string;
  /** Default `main.log`. */
  fileName?: string;
  /** Rotate past this size. Default 1 MiB. */
  maxBytes?: number;
  /** Files kept, counting the current one. Default 5. */
  maxFiles?: number;
  /** Lowest level written. Default `info`. */
  level?: LogLevel;
  /** Also print each redacted line here, e.g. the console while developing. */
  mirror?: ConsoleLike;
  /** Defaults to a new redactor primed with `env`. */
  redactor?: Redactor;
  /** Secret-looking variables here (`*_TOKEN`, `*_PAT`, `*_API_KEY`, …) are redacted everywhere. Default `process.env`. */
  env?: Record<string, string | undefined>;
  now?: () => Date;
  /** Warnings and errors kept for diagnostics. Default 50. */
  recentLimit?: number;
  /** Scope of the root logger. Default `main`. */
  scope?: string;
}

interface Core {
  directory: string;
  filePath: string;
  files: () => string[];
  redactor: Redactor;
  minRank: number;
  mirror: ConsoleLike | undefined;
  now: () => Date;
  recent: LoggedProblem[];
  recentLimit: number;
  write: (text: string) => void;
}

export function createLogger(options: LoggerOptions): Logger {
  const mirror = options.mirror;
  const file = createRotatingFile({
    directory: options.directory,
    fileName: options.fileName ?? LOG_FILE_NAME,
    maxBytes: options.maxBytes,
    maxFiles: options.maxFiles,
    onError: (cause) => {
      const code = (cause as { code?: unknown } | null)?.code;
      callOriginal(mirror ?? console, 'warn', [`[log] Could not write ${options.directory} (${typeof code === 'string' ? code : 'unknown error'})`]);
    },
  });

  const core: Core = {
    directory: options.directory,
    filePath: file.path,
    files: () => file.paths(),
    redactor: options.redactor ?? createRedactor({ env: options.env ?? process.env }),
    minRank: LEVEL_RANK[options.level ?? 'info'],
    mirror,
    now: options.now ?? (() => new Date()),
    recent: [],
    recentLimit: Math.max(0, options.recentLimit ?? DEFAULT_RECENT_LIMIT),
    write: (text) => file.write(text),
  };
  return makeLogger(core, options.scope ?? 'main', true);
}

function makeLogger(core: Core, scope: string, mirrored: boolean): Logger {
  function log(level: LogLevel, message: string, detail?: unknown): void {
    if (LEVEL_RANK[level] < core.minRank) return;
    try {
      const entry = formatEntry(core, level, scope, message, detail);
      core.write(`${entry.line}\n`);
      if (mirrored && core.mirror) callOriginal(core.mirror, level, [entry.line]);
      if (level === 'warn' || level === 'error') remember(core, entry.problem);
    } catch {
      // Logging must never break the caller.
    }
  }

  return {
    scope,
    directory: core.directory,
    filePath: core.filePath,
    redactor: core.redactor,
    log,
    debug: (message, detail) => log('debug', message, detail),
    info: (message, detail) => log('info', message, detail),
    warn: (message, detail) => log('warn', message, detail),
    error: (message, detail) => log('error', message, detail),
    child: (childScope, childOptions) => makeLogger(core, childScope, childOptions?.mirror ?? mirrored),
    recentProblems: () => core.recent.map((problem) => ({ ...problem })),
    files: core.files,
  };
}

function formatEntry(
  core: Core,
  level: LogLevel,
  scope: string,
  message: string,
  detail: unknown,
): { line: string; problem: LoggedProblem } {
  const { redactor } = core;
  const at = core.now().toISOString();
  const text = truncate(redactor.redactText(typeof message === 'string' ? message : String(message)), MAX_MESSAGE_CHARS);
  const rendered = detail === undefined ? undefined : truncate(renderDetail(redactor, detail), MAX_DETAIL_CHARS);

  // Continuation lines are indented, so a message (say, one from the renderer) cannot pass for a line of its own.
  const head = `${at} ${level.toUpperCase().padEnd(5)} [${scope}] ${text.replace(/\r?\n/g, '\n  ')}`;
  const body = rendered === undefined || rendered === '' ? head : isShort(rendered) ? `${head} ${rendered}` : `${head}\n${indent(rendered)}`;
  // A last pass over the finished line: formatting must not be able to reassemble a secret.
  const line = redactor.redactText(body);

  const problem: LoggedProblem = { at, level: level === 'error' ? 'error' : 'warn', scope, message: text };
  if (rendered) problem.detail = truncate(rendered, MAX_PROBLEM_DETAIL_CHARS);
  return { line, problem };
}

function renderDetail(redactor: Redactor, detail: unknown): string {
  if (typeof detail === 'string') return redactor.redactText(detail);
  if (detail instanceof Error) return renderError(redactor, detail, 0);
  return stringify(redactor.redactValue(detail));
}

/** The stack (which starts with "Name: message"), any own fields such as `code`, then the cause chain. */
function renderError(redactor: Redactor, error: Error, depth: number): string {
  const stack = typeof error.stack === 'string' && error.stack.length > 0 ? error.stack : '';
  const head = stack.includes(error.message) ? stack : [`${error.name}: ${error.message}`, stack].filter(Boolean).join('\n');
  const lines = [redactor.redactText(head)];

  const own = Object.entries(error).filter(([key]) => !['name', 'message', 'stack', 'cause'].includes(key));
  if (own.length > 0) lines.push(stringify(redactor.redactValue(Object.fromEntries(own))));

  if (error.cause !== undefined) {
    const cause =
      error.cause instanceof Error
        ? depth < MAX_CAUSE_DEPTH
          ? renderError(redactor, error.cause, depth + 1)
          : `${error.cause.name}: ${redactor.redactText(error.cause.message)}`
        : renderDetail(redactor, error.cause);
    lines.push(`Caused by: ${cause}`);
  }
  return lines.join('\n');
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isShort(text: string): boolean {
  return !text.includes('\n') && text.length <= 300;
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join('\n');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more characters)`;
}

function remember(core: Core, problem: LoggedProblem): void {
  if (core.recentLimit === 0) return;
  core.recent.push(problem);
  if (core.recent.length > core.recentLimit) core.recent.splice(0, core.recent.length - core.recentLimit);
}

type ConsoleMethod = keyof ConsoleLike;

/** Calls the console method `captureConsole` replaced, if it did, so mirroring never loops back into the log. */
export function callOriginal(target: ConsoleLike, method: ConsoleMethod, args: unknown[]): void {
  const current = target[method] as ((...args: unknown[]) => void) & { [ORIGINAL_CONSOLE_METHOD]?: (...args: unknown[]) => void };
  const original = current[ORIGINAL_CONSOLE_METHOD] ?? current;
  try {
    original.apply(target, args);
  } catch {
    // A closed stdout (EPIPE) must not break logging.
  }
}
