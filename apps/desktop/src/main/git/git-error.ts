import { err, type Err } from '@agent-lanes/contracts';

/**
 * Why a git call failed. Main-process services branch on these; handlers turn them into a contract
 * `Err` (most become INTERNAL; later tickets map the ones the design names, e.g. GIT_DIRTY).
 */
export type GitErrorCode =
  /** The git executable could not be found (not installed, or not on PATH). */
  | 'GIT_NOT_FOUND'
  /** Git is installed but older than MIN_GIT_VERSION. */
  | 'GIT_TOO_OLD'
  /** The process could not start for another reason (permissions, bad executable). */
  | 'SPAWN_FAILED'
  /** The working directory does not exist. */
  | 'CWD_NOT_FOUND'
  /** The working directory is not inside a git repository. */
  | 'NOT_A_REPO'
  /** Git ran longer than the timeout and was killed. */
  | 'TIMEOUT'
  /** The caller's AbortSignal fired and git was killed. */
  | 'ABORTED'
  /** Git printed more than the output limit and was killed. */
  | 'OUTPUT_TOO_LARGE'
  /** The call itself was malformed (relative cwd, NUL byte in an argument, …); git was not started. */
  | 'INVALID_ARGUMENT'
  /** Git exited with a code the caller did not allow. */
  | 'COMMAND_FAILED'
  /** Git succeeded but printed something the porcelain parser did not understand. */
  | 'PARSE_FAILED';

export interface GitErrorInit {
  /** The git arguments, already redacted. */
  args?: readonly string[];
  cwd?: string;
  exitCode?: number | null;
  /** Git's stderr, already redacted and capped. */
  stderr?: string;
}

/**
 * Thrown by the git runner, parsers and service. Messages and fields never carry credentials, and
 * there is deliberately no `cause`: Node's exec error repeats the raw command line.
 */
export class GitError extends Error {
  override readonly name = 'GitError';
  readonly code: GitErrorCode;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(code: GitErrorCode, message: string, init: GitErrorInit = {}) {
    super(message);
    this.code = code;
    this.args = init.args ?? [];
    this.cwd = init.cwd;
    this.exitCode = init.exitCode ?? null;
    this.stderr = init.stderr ?? '';
  }
}

export function isGitError(value: unknown, code?: GitErrorCode): value is GitError {
  return value instanceof GitError && (code === undefined || value.code === code);
}

/**
 * A contract `Err` for a failed git call, for IPC handlers that have no more specific mapping.
 * Anything that is not a GitError is reported as INTERNAL too, with its message redacted.
 */
export function gitErrorToErr(error: unknown): Err {
  if (error instanceof GitError) {
    return err('INTERNAL', error.message, { gitCode: error.code, exitCode: error.exitCode });
  }
  const message = error instanceof Error ? error.message : String(error);
  return err('INTERNAL', redactText(message));
}

/** `scheme://user:password@host` → `scheme://***@host`. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
/** `Authorization: Bearer abc`, `-c http.extraHeader=Authorization: Basic abc`. */
const AUTH_HEADER = /(authorization\s*:\s*)\S.*$/gim;

/** Removes credentials git may echo back: URL user-info and Authorization headers. */
export function redactText(text: string): string {
  return text.replace(URL_USERINFO, '$1***@').replace(AUTH_HEADER, '$1***');
}

/** Redacts one argument; also hides the whole value of any `*extraheader=` config. */
export function redactArg(arg: string): string {
  const header = /^([^=]*extraheader=)/i.exec(arg);
  if (header) return `${header[1]}***`;
  return redactText(arg);
}

const STDERR_LIMIT = 4096;

export function redactStderr(stderr: string): string {
  const trimmed = stderr.trim();
  const capped = trimmed.length > STDERR_LIMIT ? `${trimmed.slice(0, STDERR_LIMIT)}…` : trimmed;
  return redactText(capped);
}

/** `git status --porcelain=v2 "a b"` style rendering for messages; args must already be redacted. */
export function formatCommand(args: readonly string[]): string {
  const shown = args.map((arg) => (arg === '' || /[\s"'\\]/.test(arg) ? JSON.stringify(arg) : arg));
  return ['git', ...shown].join(' ');
}
