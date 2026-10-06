/**
 * Every main-process call returns a Result instead of throwing (design §12).
 * The first six codes come from the design; VALIDATION and INTERNAL cover contract
 * violations and unexpected failures so nothing crosses IPC as a thrown string.
 */
export const ERROR_CODES = [
  'ADO_UNAUTHORIZED',
  'ADO_SCOPE_MISSING',
  'SESSION_LOST',
  'BUILD_FAILED',
  'MERGE_CONFLICT',
  'GIT_DIRTY',
  'VALIDATION',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface Ok<T> {
  ok: true;
  data: T;
}

export interface Err {
  ok: false;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(code: ErrorCode, message: string, details?: unknown): Err {
  return details === undefined ? { ok: false, code, message } : { ok: false, code, message, details };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}
