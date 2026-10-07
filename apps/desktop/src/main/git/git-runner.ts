import { execFile, type ExecFileException } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { GitError, formatCommand, redactArg, redactStderr, redactText, type GitErrorCode } from './git-error';
import { formatMinimumGitVersion } from './git-version';

/**
 * Runs git as a child process (AL-080). Arguments go to `execFile` as an array, with no shell in
 * between, so branch names, paths and messages are passed to git verbatim: quotes, spaces, `;`,
 * `$(…)`, `%VAR%` and the like are never interpreted. Every failure becomes a typed GitError.
 *
 * Callers still put user-supplied revisions after `--end-of-options` and paths after `--`, so a
 * value that starts with `-` cannot be read as an option (see git-service.ts).
 */
export interface GitRunOptions {
  /** Absolute working directory; git runs there. */
  cwd: string;
  /** Kill git after this many milliseconds. Defaults to the runner's `defaultTimeoutMs`. */
  timeoutMs?: number;
  /** Extra environment variables for this call (on top of the runner's). */
  env?: Readonly<Record<string, string>>;
  /** Kills git when aborted; the call rejects with ABORTED. */
  signal?: AbortSignal;
  /** Exit codes besides 0 that count as success, e.g. `[1]` for `diff --quiet` or `merge-base --is-ancestor`. */
  allowedExitCodes?: readonly number[];
  /** Limit for stdout and for stderr, in bytes. Defaults to the runner's `maxOutputBytes`. */
  maxOutputBytes?: number;
}

export interface GitOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** `git(args, { cwd })`. Rejects with GitError only. */
export type GitRunner = (args: readonly string[], options: GitRunOptions) => Promise<GitOutput>;

export interface GitRunnerConfig {
  /** Executable to run. Defaults to `git` from PATH. */
  gitPath?: string;
  /** Defaults to 60 s. */
  defaultTimeoutMs?: number;
  /** Defaults to 64 MiB. */
  maxOutputBytes?: number;
  /** Environment applied to every call, e.g. tests isolating git from the user's config. */
  env?: Readonly<Record<string, string>>;
}

export const DEFAULT_GIT_TIMEOUT_MS = 60_000;
export const DEFAULT_GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Inherited variables that would point git at a different repository than `cwd` (git's own
 * `local_repo_env` list), e.g. when Agent Lanes or its tests are started from inside a git hook.
 * A caller may still set them explicitly through `env`.
 */
const REPO_LOCATING_ENV = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
]);

/**
 * Fixed for every call: never block on a credential prompt (there is no terminal), and use git's
 * untranslated messages so stderr can be classified.
 */
const FIXED_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C',
};

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || REPO_LOCATING_ENV.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  return env;
}

function invalid(message: string, args: readonly string[], cwd: string | undefined): GitError {
  return new GitError('INVALID_ARGUMENT', message, { args, cwd });
}

function validate(args: readonly string[], options: GitRunOptions, redacted: readonly string[]): void {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw invalid('git arguments must be an array of strings', redacted, options.cwd);
  }
  if (args.some((arg) => arg.includes('\0'))) {
    throw invalid(`${formatCommand(redacted)}: an argument contains a NUL byte`, redacted, options.cwd);
  }
  if (typeof options.cwd !== 'string' || options.cwd === '' || !isAbsolute(options.cwd)) {
    throw invalid(`${formatCommand(redacted)}: cwd must be an absolute path`, redacted, options.cwd);
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The line that explains the failure: git's `fatal:`/`error:` line when there is one. */
function headline(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => /^(fatal|error):/i.test(line)) ?? lines[0] ?? '';
}

function exitFailureCode(stderr: string): GitErrorCode {
  return /not a git repository/i.test(stderr) ? 'NOT_A_REPO' : 'COMMAND_FAILED';
}

export function createGitRunner(config: GitRunnerConfig = {}): GitRunner {
  const gitPath = config.gitPath ?? 'git';
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const defaultMaxOutput = config.maxOutputBytes ?? DEFAULT_GIT_MAX_OUTPUT_BYTES;

  return async function git(args, options) {
    const redacted = Array.isArray(args) ? args.map((arg) => (typeof arg === 'string' ? redactArg(arg) : '?')) : [];
    validate(args, options, redacted);
    const { cwd } = options;
    const command = formatCommand(redacted);

    if (options.signal?.aborted) {
      throw new GitError('ABORTED', `${command} was cancelled before it started`, { args: redacted, cwd });
    }

    const env = { ...inheritedEnv(), ...FIXED_ENV, ...config.env, ...options.env };
    const timeout = options.timeoutMs ?? defaultTimeoutMs;

    const outcome = await new Promise<{ error: ExecFileException | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        try {
          const child = execFile(
            gitPath,
            [...args],
            {
              cwd,
              env,
              timeout,
              maxBuffer: options.maxOutputBytes ?? defaultMaxOutput,
              encoding: 'utf8',
              windowsHide: true,
              shell: false,
              signal: options.signal,
            },
            (error, stdout, stderr) => resolve({ error, stdout, stderr }),
          );
          // Nothing is ever piped in: a command that reads stdin sees EOF instead of hanging.
          child.stdin?.on('error', () => undefined);
          child.stdin?.end();
        } catch (cause) {
          const reason = redactText(cause instanceof Error ? cause.message : String(cause));
          reject(invalid(`${command} could not start: ${reason}`, redacted, cwd));
        }
      },
    );

    const { error, stdout } = outcome;
    if (!error) return { stdout, stderr: redactText(outcome.stderr), exitCode: 0 };

    const stderr = redactStderr(outcome.stderr);
    // The raw ExecFileException is not attached as `cause`: its message and `cmd` hold the unredacted command line.
    const base = { args: redacted, cwd, stderr };

    if (options.signal?.aborted || error.name === 'AbortError') {
      throw new GitError('ABORTED', `${command} was cancelled`, base);
    }
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new GitError('OUTPUT_TOO_LARGE', `${command} printed more output than the limit and was stopped`, base);
    }
    // Node only kills the child itself for the timeout, the output limit and the abort signal.
    if (error.killed) {
      throw new GitError('TIMEOUT', `${command} did not finish within ${timeout} ms and was stopped`, base);
    }
    if (typeof error.code === 'number') {
      if (options.allowedExitCodes?.includes(error.code)) {
        return { stdout, stderr: redactText(outcome.stderr), exitCode: error.code };
      }
      const why = headline(stderr);
      throw new GitError(
        exitFailureCode(stderr),
        `${command} failed (exit ${error.code})${why ? `: ${why}` : ''}`,
        { ...base, exitCode: error.code },
      );
    }
    if (error.signal) {
      throw new GitError('COMMAND_FAILED', `${command} was killed by ${error.signal}`, base);
    }
    if (error.code === 'ENOENT') {
      if (!(await isDirectory(cwd))) {
        throw new GitError('CWD_NOT_FOUND', `${command}: the folder ${cwd} does not exist`, base);
      }
      throw new GitError(
        'GIT_NOT_FOUND',
        `Git was not found (tried "${gitPath}"). Install Git ${formatMinimumGitVersion()} or later and make sure it is on PATH.`,
        base,
      );
    }
    throw new GitError('SPAWN_FAILED', `${command} could not start (${String(error.code ?? error.name)})`, base);
  };
}
