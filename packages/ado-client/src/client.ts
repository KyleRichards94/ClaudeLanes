import { err, ok, type Err, type Result } from '@agent-lanes/contracts';
import { z } from 'zod';
import { ADO_API_VERSION, DEFAULT_MAX_PAGES, DEFAULT_TIMEOUT_MS } from './constants';
import { adoErr, formatIssues, httpError, loginPageError, parseAdoErrorBody } from './errors';
import { isTrustedTarget, normalizeOrgUrl } from './org-url';
import { createRedactor, type Redactor } from './redact';
import { abortableSleep, DEFAULT_RETRY_POLICY, parseRetryAfter, RETRYABLE_STATUSES, retryDelay, type RetryPolicy } from './retry';

/** The subset of `fetch` the client uses: Node's global fetch, Electron's `net.fetch`, or a test double. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Query values; arrays are comma-joined, the way ADO takes `ids=1,2,3` and `fields=…`. `undefined`/`null` are skipped. */
export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;

export interface AdoLogEntry {
  level: 'debug' | 'warn' | 'error';
  /** One line, e.g. `GET https://dev.azure.com/contoso/_apis/projects → 200 in 84 ms`. Redacted. */
  message: string;
  method: string;
  url: string;
  status?: number;
  attempt: number;
  durationMs: number;
}

export interface AdoClientOptions {
  /** `https://dev.azure.com/<org>`, `https://<org>.visualstudio.com` or an Azure DevOps Server collection URL. */
  orgUrl: string;
  /** Personal access token; sent only as a Basic `Authorization` header and redacted from every error and log entry. */
  pat: string;
  /** Defaults to the global `fetch`, looked up at call time. */
  fetch?: FetchLike;
  /** Per-attempt timeout, including reading the body. Default 30 s. */
  timeoutMs?: number;
  /** 429/503 retry policy. Default: 3 retries, 1 s / 2 s / 4 s backoff without `Retry-After`, waits capped at 30 s. */
  retry?: Partial<RetryPolicy>;
  /** Receives one redacted entry per attempt. Errors thrown by the callback are ignored. */
  log?: (entry: AdoLogEntry) => void;
  /** Test seam for retry waits. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Test seam for HTTP-date `Retry-After` values. */
  now?: () => number;
}

export interface AdoCallOptions {
  query?: Record<string, QueryValue>;
  /** Overrides `api-version` (e.g. `7.1-preview.4` for the Comments API). A version already in `path` wins. */
  apiVersion?: string;
  signal?: AbortSignal;
  /** Overrides the client's per-attempt timeout. */
  timeoutMs?: number;
}

export interface AdoRequest<T> extends AdoCallOptions {
  method?: HttpMethod;
  /**
   * Path under the organisation (`/_apis/projects`, `/{project}/_apis/wit/wiql`; build it with `adoPath`
   * so names are encoded), or an absolute https URL on the organisation's own Azure DevOps host(s),
   * such as a link returned by ADO. Anything else is refused before the PAT is sent.
   */
  path: string;
  /** Sent as JSON. */
  body?: unknown;
  /** Defaults to `application/json`; work item updates use `application/json-patch+json`. */
  contentType?: string;
  /** Validates the response. An empty body (204) is validated as `undefined`. */
  schema: z.ZodType<T>;
}

export interface AdoListOptions extends AdoCallOptions {
  /** Envelope key holding the items. Default `value` (`{ count, value: [...] }`). */
  itemsKey?: string;
  /** Query parameter that carries the continuation token. Default `continuationToken`. */
  tokenParam?: string;
  /** Stop with an error rather than fetch more pages than this. Default 100. */
  maxPages?: number;
}

export interface AdoClient {
  /** The normalised organisation URL, without a trailing slash. */
  readonly orgUrl: string;
  /** One request with auth, `api-version`, retry, timeout and error mapping. Never throws. */
  request<T>(request: AdoRequest<T>): Promise<Result<T>>;
  /** `request` with `method: 'GET'`. */
  get<T>(path: string, schema: z.ZodType<T>, options?: AdoCallOptions): Promise<Result<T>>;
  /**
   * Every item of a list endpoint, following continuation tokens from the `x-ms-continuationtoken`
   * header or the body's `continuationToken` until there are none. Never throws; a failing page
   * fails the whole call rather than returning a partial list.
   */
  list<T>(path: string, itemSchema: z.ZodType<T>, options?: AdoListOptions): Promise<Result<T[]>>;
}

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;
const CONTINUATION_HEADER = 'x-ms-continuationtoken';

type Attempt =
  | { type: 'response'; status: number; headers: Headers; text: string }
  | { type: 'timeout' }
  | { type: 'aborted' }
  | { type: 'network'; cause: unknown };

interface Received<T> {
  data: T;
  headers: Headers;
}

/**
 * Creates the Azure DevOps REST client for one organisation (design §7, AL-060). Returns
 * `VALIDATION` instead of a client when the org URL or PAT can't be used; the messages never
 * echo either value.
 */
export function createAdoClient(options: AdoClientOptions): Result<AdoClient> {
  const org = normalizeOrgUrl(typeof options.orgUrl === 'string' ? options.orgUrl : '');
  if (!org.ok) return org;

  const pat = typeof options.pat === 'string' ? options.pat.trim() : '';
  if (!PRINTABLE_ASCII.test(pat)) {
    return err('VALIDATION', 'The personal access token is empty or contains spaces or non-ASCII characters.');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
  if (!isPositive(timeoutMs) || !Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || !isPositive(policy.baseDelayMs) || !isPositive(policy.maxDelayMs)) {
    return err('VALIDATION', 'timeoutMs and the retry delays must be positive numbers and maxRetries a whole number ≥ 0.');
  }

  const fetchOption: FetchLike | undefined =
    options.fetch ?? (typeof globalThis.fetch === 'function' ? (input, init) => globalThis.fetch(input, init) : undefined);
  if (!fetchOption) return err('INTERNAL', 'No fetch implementation is available for the Azure DevOps client.');
  const doFetch: FetchLike = fetchOption;

  const orgUrl = org.data;
  const orgBase = new URL(orgUrl);
  // Azure DevOps Server only speaks the REST versions of its release (2020 → 6.x); learnt from its errors.
  const versions = createApiVersionNegotiator();
  const authorization = `Basic ${btoa(`:${pat}`)}`;
  const redact: Redactor = createRedactor(pat, authorization);
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;

  const log = (entry: AdoLogEntry): void => {
    if (!options.log) return;
    try {
      options.log(redact(entry));
    } catch {
      // A broken logger must not break the call.
    }
  };

  function buildUrl(path: string, call: AdoCallOptions): Result<URL> {
    if (typeof path !== 'string' || path.includes('#')) {
      return adoErr('VALIDATION', 'The request path is not valid.', { kind: 'config' });
    }
    let url: URL;
    if (ABSOLUTE_URL.test(path)) {
      try {
        url = new URL(path);
      } catch {
        return adoErr('VALIDATION', 'The request URL is not valid.', { kind: 'config' });
      }
      if (!isTrustedTarget(url, orgBase)) {
        return adoErr('VALIDATION', `Refusing to send the organisation's token to ${url.protocol}//${url.host}: it is not an Azure DevOps host for ${orgUrl}.`, {
          kind: 'config',
        });
      }
    } else {
      if (!path.startsWith('/')) {
        return adoErr('VALIDATION', `The request path must start with "/" (got "${path}").`, { kind: 'config' });
      }
      url = new URL(`${orgUrl}${path}`);
      const orgPath = orgBase.pathname === '/' ? '' : orgBase.pathname;
      if (url.origin !== orgBase.origin || (url.pathname !== orgPath && !url.pathname.startsWith(`${orgPath}/`))) {
        return adoErr('VALIDATION', `The request path "${path}" leaves the organisation ${orgUrl}.`, { kind: 'config' });
      }
    }

    for (const [key, value] of Object.entries(call.query ?? {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    if (!url.searchParams.has('api-version')) url.searchParams.set('api-version', versions.effective(call.apiVersion ?? ADO_API_VERSION));
    return ok(url);
  }

  async function attempt(url: string, init: RequestInit, attemptTimeoutMs: number, signal: AbortSignal | undefined): Promise<Attempt> {
    if (signal?.aborted) return { type: 'aborted' };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, attemptTimeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await doFetch(url, { ...init, signal: controller.signal });
      // The body is read under the same timeout: a stalled stream is still a timeout.
      const text = await response.text();
      return { type: 'response', status: response.status, headers: response.headers, text };
    } catch (cause) {
      if (timedOut) return { type: 'timeout' };
      if (signal?.aborted) return { type: 'aborted' };
      return { type: 'network', cause };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function execute<T>(request: AdoRequest<T>): Promise<Result<Received<T>>> {
    const method: HttpMethod = request.method ?? 'GET';
    const built = buildUrl(request.path, request);
    if (!built.ok) return built;

    let url = built.data.toString();
    const where = `${built.data.origin}${built.data.pathname}`;
    let versionRetries = 0;
    const attemptTimeoutMs = request.timeoutMs ?? timeoutMs;
    const headers: Record<string, string> = {
      Authorization: authorization,
      Accept: 'application/json',
      // Ask ADO for a 401 instead of a redirect to its sign-in page when the token isn't accepted.
      'X-TFS-FedAuthRedirect': 'Suppress',
    };
    const init: RequestInit = { method, headers };
    if (request.body !== undefined) {
      headers['Content-Type'] = request.contentType ?? 'application/json';
      init.body = JSON.stringify(request.body);
    }

    for (let attemptNo = 1; ; attemptNo += 1) {
      const started = now();
      const outcome = await attempt(url, init, attemptTimeoutMs, request.signal);
      const durationMs = Math.max(0, now() - started);
      const entry = { method, url, attempt: attemptNo, durationMs };

      if (outcome.type === 'timeout') {
        log({ ...entry, level: 'error', message: `${method} ${where} timed out after ${attemptTimeoutMs} ms` });
        return adoErr('INTERNAL', `Azure DevOps did not answer ${method} ${where} within ${formatDuration(attemptTimeoutMs)}.`, {
          kind: 'timeout',
          method,
          url,
          attempts: attemptNo,
        });
      }
      if (outcome.type === 'aborted') {
        log({ ...entry, level: 'debug', message: `${method} ${where} cancelled` });
        return adoErr('INTERNAL', `${method} ${where} was cancelled.`, { kind: 'aborted', method, url, attempts: attemptNo });
      }
      if (outcome.type === 'network') {
        const cause = describe(outcome.cause);
        log({ ...entry, level: 'error', message: `${method} ${where} failed: ${cause}` });
        return adoErr('INTERNAL', `Could not reach Azure DevOps for ${method} ${where}: ${cause}`, {
          kind: 'network',
          method,
          url,
          attempts: attemptNo,
          cause,
        });
      }

      const { status, headers: responseHeaders, text } = outcome;
      const activityId = responseHeaders.get('activityid') ?? undefined;
      const failure = { method, url, status, attempts: attemptNo, ...(activityId ? { activityId } : {}) };

      if (RETRYABLE_STATUSES.has(status)) {
        const retryAfterMs = parseRetryAfter(responseHeaders.get('retry-after'), now());
        const wait = retryDelay(attemptNo, retryAfterMs, policy);
        if (attemptNo <= policy.maxRetries && wait <= policy.maxDelayMs) {
          log({ ...entry, status, level: 'warn', message: `${method} ${where} → ${status}, retry ${attemptNo} of ${policy.maxRetries} in ${wait} ms` });
          try {
            await sleep(wait, request.signal);
          } catch {
            return adoErr('INTERNAL', `${method} ${where} was cancelled.`, { kind: 'aborted', method, url, status, attempts: attemptNo });
          }
          continue;
        }
        log({ ...entry, status, level: 'error', message: `${method} ${where} → ${status}, giving up after ${attemptNo} attempts` });
        const why =
          attemptNo <= policy.maxRetries
            ? `asked to wait ${formatDuration(wait)}, longer than the client waits (${formatDuration(policy.maxDelayMs)})`
            : `still ${status} after ${policy.maxRetries} retries`;
        return adoErr('INTERNAL', `Azure DevOps is throttling or unavailable for ${method} ${where} (${why}).`, {
          kind: 'throttled',
          ...failure,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          ...parseAdoErrorBody(text),
        });
      }

      const isHtml = (responseHeaders.get('content-type') ?? '').toLowerCase().includes('text/html');
      if (status === 203 || (status >= 200 && status < 300 && isHtml)) {
        log({ ...entry, status, level: 'error', message: `${method} ${where} → ${status} sign-in page` });
        return loginPageError({ ...failure, where });
      }
      if (status === 400 && versionRetries < 2) {
        const sent = built.data.searchParams.get('api-version') ?? '';
        const next = versions.learn(sent, text);
        if (next && next !== sent) {
          versionRetries += 1;
          log({ ...entry, status, level: 'warn', message: `${method} ${where} → 400, the server does not take api-version ${sent}; retrying with ${next}` });
          built.data.searchParams.set('api-version', next);
          url = built.data.toString();
          continue;
        }
      }
      if (status < 200 || status >= 300) {
        log({ ...entry, status, level: 'error', message: `${method} ${where} → ${status}` });
        return httpError({ ...failure, where, ...parseAdoErrorBody(text) });
      }

      log({ ...entry, status, level: 'debug', message: `${method} ${where} → ${status} in ${durationMs} ms` });

      let json: unknown;
      if (text.trim() !== '') {
        try {
          json = JSON.parse(text);
        } catch {
          return adoErr('VALIDATION', `Azure DevOps answered ${method} ${where} with a body that is not JSON.`, {
            kind: 'invalid-json',
            ...failure,
          });
        }
      }
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) {
        return adoErr('VALIDATION', `Azure DevOps answered ${method} ${where} with data in an unexpected shape.`, {
          kind: 'schema',
          ...failure,
          issues: formatIssues(parsed.error),
        });
      }
      return ok({ data: parsed.data, headers: responseHeaders });
    }
  }

  /** Runs `fn`, turning anything thrown into INTERNAL, and redacts every error on the way out. */
  async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
    let result: Result<T>;
    try {
      result = await fn();
    } catch (cause) {
      result = adoErr('INTERNAL', 'The Azure DevOps client failed unexpectedly.', { kind: 'unexpected', cause: describe(cause) });
    }
    return result.ok ? result : redact<Err>(result);
  }

  const client: AdoClient = {
    orgUrl,

    request<T>(request: AdoRequest<T>): Promise<Result<T>> {
      return guarded(async () => {
        const received = await execute(request);
        return received.ok ? ok(received.data.data) : received;
      });
    },

    get<T>(path: string, schema: z.ZodType<T>, options?: AdoCallOptions): Promise<Result<T>> {
      return client.request({ ...options, method: 'GET', path, schema });
    },

    list<T>(path: string, itemSchema: z.ZodType<T>, options: AdoListOptions = {}): Promise<Result<T[]>> {
      return guarded(async () => {
        const { itemsKey = 'value', tokenParam = 'continuationToken', maxPages = DEFAULT_MAX_PAGES, ...call } = options;
        const pageSchema = z.object({ [itemsKey]: z.array(itemSchema), continuationToken: z.string().nullish() } as Record<string, z.ZodType>);
        const items: T[] = [];
        const seen = new Set<string>();
        let token: string | undefined;

        for (let page = 1; page <= maxPages; page += 1) {
          const received = await execute({ ...call, method: 'GET', path, schema: pageSchema, query: { ...call.query, [tokenParam]: token } });
          if (!received.ok) return received;

          items.push(...(received.data.data[itemsKey] as T[]));
          const bodyToken = received.data.data['continuationToken'] as string | null | undefined;
          const next = received.data.headers.get(CONTINUATION_HEADER) || bodyToken || undefined;
          if (next === undefined) return ok(items);
          if (seen.has(next)) {
            return adoErr('INTERNAL', `Azure DevOps repeated a continuation token while listing ${path}; stopped after ${page} pages.`, {
              kind: 'paging',
              method: 'GET',
              attempts: page,
            });
          }
          seen.add(next);
          token = next;
        }
        return adoErr('INTERNAL', `Listing ${path} needed more than ${maxPages} pages; stopped.`, { kind: 'paging', method: 'GET', attempts: maxPages });
      });
    },
  };

  return ok(Object.freeze(client));
}

const OUT_OF_RANGE = /latest REST API version this server supports is (\d+\.\d+)/i;
const PREVIEW_REQUIRED = /-preview flag must be supplied|is under preview/i;

function baseVersion(version: string): string {
  return version.split('-')[0] ?? version;
}

function isPreview(version: string): boolean {
  return /-preview/i.test(version);
}

/** Orders `major.minor` versions numerically. */
function compareVersions(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/**
 * Per-organisation `api-version` negotiation. The client asks for REST 7.1; an Azure DevOps Server
 * answers 400 "…the latest REST API version this server supports is 6.1" or "…under preview. The
 * -preview flag must be supplied". `learn` reads those answers and returns the version to retry with;
 * `effective` applies what was learnt to every later call, so only the first call pays the retry.
 * Preview revisions (`7.1-preview.4`) drop to the server's plain `-preview`, which takes its latest.
 */
export function createApiVersionNegotiator() {
  let ceiling: string | undefined;
  const previewOnly = new Set<string>();

  function effective(requested: string): string {
    let version = requested;
    if (ceiling && compareVersions(baseVersion(version), ceiling) > 0) {
      version = isPreview(version) ? `${ceiling}-preview` : ceiling;
    }
    if (!isPreview(version) && previewOnly.has(baseVersion(version))) version = `${baseVersion(version)}-preview`;
    return version;
  }

  function learn(sent: string, body: string): string | undefined {
    const range = OUT_OF_RANGE.exec(body);
    if (range?.[1]) {
      if (!ceiling || compareVersions(range[1], ceiling) < 0) ceiling = range[1];
      return effective(sent);
    }
    if (PREVIEW_REQUIRED.test(body) && !isPreview(sent)) {
      previewOnly.add(baseVersion(sent));
      return effective(sent);
    }
    return undefined;
  }

  return { effective, learn };
}

function isPositive(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  return ms % 1_000 === 0 ? `${ms / 1_000} s` : `${(ms / 1_000).toFixed(1)} s`;
}

/** A thrown value as one line; the caller redacts it. */
function describe(cause: unknown): string {
  if (cause instanceof Error) {
    const inner = cause.cause instanceof Error ? ` (${cause.cause.message})` : '';
    return `${cause.message}${inner}`;
  }
  return String(cause);
}
