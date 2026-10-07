import { err, type Err } from '@agent-lanes/contracts';
import { z } from 'zod';

/**
 * What went wrong, beyond the `Result` code. Sits in `Err.details` of every failed call so callers
 * (AdoService, the toast layer, logs) can tell a 404 from a timeout without parsing messages.
 */
export type AdoErrorKind =
  /** Bad client options, request path or URL; nothing was sent. */
  | 'config'
  /** A non-2xx answer that isn't one of the kinds below. */
  | 'http'
  /** 401: the PAT is wrong, expired or revoked. */
  | 'unauthorized'
  /** 403: the PAT lacks a scope or the user lacks a permission. */
  | 'forbidden'
  /** 203, or an HTML sign-in page where JSON was expected: ADO did not accept the credentials. */
  | 'login-page'
  /** 429 or 503 after every retry, or with a `Retry-After` longer than the client waits. */
  | 'throttled'
  /** No answer within `timeoutMs`. */
  | 'timeout'
  /** The caller's `AbortSignal` fired. */
  | 'aborted'
  /** DNS, TLS, connection reset: no HTTP response at all. */
  | 'network'
  /** A 2xx body that isn't JSON. */
  | 'invalid-json'
  /** JSON that doesn't match the call's zod schema. */
  | 'schema'
  /** Continuation-token paging that repeats a token or runs past `maxPages`. */
  | 'paging'
  /** Anything thrown that the kinds above don't cover. */
  | 'unexpected';

export interface AdoErrorDetails {
  source: 'ado';
  kind: AdoErrorKind;
  method?: string;
  /** Request URL with its query string; never holds credentials. */
  url?: string;
  status?: number;
  /** Fetch attempts made, including retries. */
  attempts?: number;
  /** Server-requested wait on the last throttled answer. */
  retryAfterMs?: number;
  /** ADO's `ActivityId` response header, for support requests. */
  activityId?: string;
  /** From ADO's JSON error body (`TF401019: …`). */
  adoMessage?: string;
  adoTypeKey?: string;
  /** zod issues for `schema` errors. */
  issues?: Array<{ path: string; message: string }>;
  /** For `network` and `unexpected`: the underlying error, redacted. */
  cause?: string;
}

/** Narrows `Err.details` to the client's details object. */
export function isAdoErrorDetails(details: unknown): details is AdoErrorDetails {
  return typeof details === 'object' && details !== null && (details as { source?: unknown }).source === 'ado';
}

export function adoErr(code: Err['code'], message: string, details: Omit<AdoErrorDetails, 'source'>): Err {
  return err(code, message, { source: 'ado', ...details } satisfies AdoErrorDetails);
}

/** ADO's error body: `{ "message": "TF401019: …", "typeKey": "GitRepositoryNotFoundException", … }`. */
const adoErrorBodySchema = z.object({
  message: z.string().optional(),
  typeKey: z.string().optional(),
});

export function parseAdoErrorBody(text: string): { adoMessage?: string; adoTypeKey?: string } {
  try {
    const parsed = adoErrorBodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return {};
    return {
      ...(parsed.data.message ? { adoMessage: parsed.data.message } : {}),
      ...(parsed.data.typeKey ? { adoTypeKey: parsed.data.typeKey } : {}),
    };
  } catch {
    return {};
  }
}

export interface HttpFailure {
  method: string;
  url: string;
  /** Origin + path, used in messages; the query string stays in `details.url`. */
  where: string;
  status: number;
  attempts: number;
  activityId?: string;
  adoMessage?: string;
  adoTypeKey?: string;
}

/**
 * Maps a non-2xx answer to a `Result` error (design §12 codes):
 * 401 → ADO_UNAUTHORIZED; 403 → ADO_SCOPE_MISSING; 400 → VALIDATION (ADO rejected the request
 * as malformed); everything else → INTERNAL with the status in `details`.
 */
export function httpError(failure: HttpFailure): Err {
  const { method, url, where, status, attempts, activityId, adoMessage, adoTypeKey } = failure;
  const details = {
    method,
    url,
    status,
    attempts,
    ...(activityId ? { activityId } : {}),
    ...(adoMessage ? { adoMessage } : {}),
    ...(adoTypeKey ? { adoTypeKey } : {}),
  };
  const suffix = adoMessage ? ` ${adoMessage}` : '';

  if (status === 401) {
    return adoErr(
      'ADO_UNAUTHORIZED',
      `Azure DevOps rejected the personal access token (401 on ${method} ${where}). It may have expired or been revoked; reconnect the organisation.${suffix}`,
      { kind: 'unauthorized', ...details },
    );
  }
  if (status === 403) {
    return adoErr(
      'ADO_SCOPE_MISSING',
      `The personal access token lacks a scope or permission for ${method} ${where} (403). It needs Work Items (read & write), Code (read & write) and Build (read).${suffix}`,
      { kind: 'forbidden', ...details },
    );
  }
  if (status === 400) {
    return adoErr('VALIDATION', `Azure DevOps rejected ${method} ${where} as invalid (400).${suffix}`, { kind: 'http', ...details });
  }
  return adoErr('INTERNAL', `Azure DevOps answered ${status} to ${method} ${where}.${suffix}`, { kind: 'http', ...details });
}

export function loginPageError(failure: Omit<HttpFailure, 'adoMessage' | 'adoTypeKey'>): Err {
  const { method, url, where, status, attempts, activityId } = failure;
  return adoErr(
    'ADO_SCOPE_MISSING',
    `Azure DevOps answered ${method} ${where} with a sign-in page instead of data (${status}): the token was not accepted for this organisation or lacks a required scope.`,
    { kind: 'login-page', method, url, status, attempts, ...(activityId ? { activityId } : {}) },
  );
}

export function formatIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.length === 0 ? '$' : `$.${issue.path.map(String).join('.')}`,
    message: issue.message,
  }));
}
