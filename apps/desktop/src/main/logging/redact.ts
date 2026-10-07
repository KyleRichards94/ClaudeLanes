/**
 * Redaction for everything the app writes to its log or puts in diagnostics (AL-214, design §8).
 *
 * Three layers, so a token is caught however it arrives:
 *
 * 1. **Known values.** Every secret the app handles is registered (the SecretStore reports each one it
 *    saves or reads; secret-looking environment variables are registered at start-up) and removed
 *    wherever it appears, together with the encoded forms it travels in: base64 (and base64 of
 *    `:<secret>`, the Basic auth header ADO uses), base64url and URL encoding.
 * 2. **Field names.** In structured values, fields named like a secret (`token`, `pat`, `apiKey`,
 *    `authorization`, `password`, `cookie`, …) lose their value, and every value under `env` /
 *    `environment` is dropped (the variable names stay, so a log still shows what was set).
 * 3. **Shapes in text.** Authorization headers, `Bearer`/`Basic` credentials, `user:pass@` in URLs,
 *    `key=value` pairs whose key names a secret, and well-known token formats (Anthropic, GitHub,
 *    JWTs, Azure DevOps PATs) are replaced even when nobody registered them.
 *
 * Redaction is idempotent: running text through it twice gives the same result.
 */

export const REDACTED = '[REDACTED]';

/** Shorter values are not registered: replacing "abc" everywhere would wreck the log. */
export const MIN_SECRET_LENGTH = 8;
/** Bounds memory if something registers values in a loop. */
const MAX_KNOWN_SECRETS = 500;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_KEYS = 200;

export interface Redactor {
  /** Registers a secret value (and its encoded forms) so it is removed from all later output. */
  addSecret(value: string | undefined | null): void;
  /** Removes registered secrets and secret-shaped text from a string. */
  redactText(text: string): string;
  /** A JSON-safe copy of `value` with secrets removed (field names, registered values and shapes). */
  redactValue(value: unknown): unknown;
}

// Not `pwd`: as an environment variable it is the working directory, which is no secret.
const SECRET_WORDS = new Set([
  'secret',
  'secrets',
  'token',
  'password',
  'passwd',
  'passphrase',
  'pat',
  'pats',
  'credential',
  'credentials',
  'ciphertext',
  'apikey',
  'authorization',
  'auth',
  'bearer',
  'cookie',
  'cookies',
  'sig',
  'signature',
]);
const SECRET_PAIRS = [
  ['api', 'key'],
  ['private', 'key'],
  ['access', 'key'],
  ['client', 'secret'],
  ['set', 'cookie'],
] as const;

/** `maskedPat` → [masked, pat]; `ADO_PAT` → [ado, pat]; `x-api-key` → [x, api, key]. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/**
 * Whether a field or variable name says it holds a secret. `masked…` fields (a token's last few
 * characters) and plural `tokens` (LLM token counts) are not secrets.
 */
export function isSecretName(name: string): boolean {
  const parts = words(name);
  if (parts[0] === 'masked') return false;
  if (parts.some((part) => SECRET_WORDS.has(part))) return true;
  return parts.some((part, index) => SECRET_PAIRS.some(([a, b]) => part === a && parts[index + 1] === b));
}

/** `env`, `environment`, `childEnv`, `envVars`: an environment block, whose values are all dropped. */
function isEnvName(name: string): boolean {
  return words(name).some((part) => part === 'env' || part === 'environment');
}

const NOT_ALREADY_REDACTED =String.raw`(?!\[REDACTED\])`;

/** `https://user:pat@host` and `https://pat@host` (git accepts a PAT as the user name). */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)(?!\[REDACTED\]@)[^\s/?#@"'<>]+@/gi;

/** `Authorization: Basic …`, `"authorization":"Bearer …"`, `x-api-key=…`, `Cookie: …` up to the end of the line or quote. */
const AUTH_SCHEMES = 'basic|bearer|token|digest|negotiate|ntlm';
const HEADER = new RegExp(
  String.raw`\b((?:proxy-)?authorization|x-api-key|api-key|x-auth-token|set-cookie|cookie)(["']?\s*[:=]\s*["']?)` +
    String.raw`(?!\s*(?:(?:${AUTH_SCHEMES})\s+)?\[REDACTED\])(?:(${AUTH_SCHEMES})\s+)?[^\r\n"']+`,
  'gi',
);

/** A credential after its scheme, wherever it appears. Twenty characters at least, so prose like "Basic settings" survives. */
const BARE_SCHEME = new RegExp(String.raw`\b(Bearer|Basic)\s+${NOT_ALREADY_REDACTED}[A-Za-z0-9\-._~+/]{20,}=*`, 'g');

/** `token=…`, `"pat": "…"`, `ANTHROPIC_API_KEY=…`, `client_secret: …`: the key ends in a secret word. */
const ASSIGNMENT = new RegExp(
  String.raw`\b([\w-]*?(?:token|secret|password|passwd|passphrase|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|pat))` +
    String.raw`(["']?\s*[:=]\s*)${NOT_ALREADY_REDACTED}("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'|[^\s"',;&}\])]+)`,
  'gi',
);

/** Formats that are a credential whatever surrounds them. */
const TOKEN_SHAPES: readonly RegExp[] = [
  // Anthropic API keys and Claude Code OAuth tokens.
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  // GitHub personal access, OAuth, app and refresh tokens.
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g,
  // JWTs (Microsoft Entra ID access tokens).
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Azure DevOps PATs: the 84-character format with the AZDO signature, and the classic 52-character base32.
  /\b[A-Za-z0-9]{76}AZDO[A-Za-z0-9]{4}\b/g,
  /\b[a-z2-7]{52}\b/g,
];

function encodedForms(secret: string): string[] {
  const forms = new Set<string>([secret]);
  const bytes = Buffer.from(secret, 'utf8');
  forms.add(bytes.toString('base64'));
  forms.add(bytes.toString('base64url'));
  // ADO and git send a PAT as Basic auth with an empty user name.
  forms.add(Buffer.from(`:${secret}`, 'utf8').toString('base64'));
  forms.add(encodeURIComponent(secret));
  return [...forms].filter((form) => form.length >= MIN_SECRET_LENGTH);
}

export interface RedactorOptions {
  /** Environment whose secret-looking variables (`*_TOKEN`, `*_PAT`, `*_API_KEY`, …) are registered up front. */
  env?: Record<string, string | undefined>;
}

export function createRedactor(options: RedactorOptions = {}): Redactor {
  const known = new Set<string>();
  // Longest first, so a secret that contains another is replaced whole.
  let ordered: string[] = [];

  function addSecret(value: string | undefined | null): void {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length < MIN_SECRET_LENGTH || known.size >= MAX_KNOWN_SECRETS) return;
    let added = false;
    for (const form of encodedForms(trimmed)) {
      if (!known.has(form)) {
        known.add(form);
        added = true;
      }
    }
    if (added) ordered = [...known].sort((a, b) => b.length - a.length);
  }

  function redactText(text: string): string {
    let out = text;
    for (const secret of ordered) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    out = out.replace(URL_USERINFO, `$1${REDACTED}@`);
    out = out.replace(HEADER, (_match, name: string, separator: string, scheme: string | undefined) =>
      scheme ? `${name}${separator}${scheme} ${REDACTED}` : `${name}${separator}${REDACTED}`,
    );
    out = out.replace(BARE_SCHEME, `$1 ${REDACTED}`);
    out = out.replace(ASSIGNMENT, (_match, key: string, separator: string, value: string) => {
      const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : '';
      return `${key}${separator}${quote}${REDACTED}${quote}`;
    });
    for (const shape of TOKEN_SHAPES) out = out.replace(shape, REDACTED);
    return out;
  }

  function redactValue(value: unknown): unknown {
    return walk(value, 0, new WeakSet<object>());
  }

  function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return redactText(value);
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value !== 'object') return String(value);

    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    if (value instanceof URL) return redactText(value.href);
    if (value instanceof RegExp) return value.toString();
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[Binary ${value.byteLength} bytes]`;
    if (seen.has(value)) return '[Circular]';
    if (depth >= MAX_DEPTH) return '[Object]';
    seen.add(value);

    try {
      if (value instanceof Error) return walkError(value, depth, seen);
      if (Array.isArray(value)) return walkArray(value, depth, seen);
      if (value instanceof Set) return walkArray([...value], depth, seen);
      if (value instanceof Map) return walkEntries([...value].map(([key, item]) => [String(key), item]), depth, seen);
      if (isHeadersLike(value)) return walkEntries([...value.entries()], depth, seen);
      return walkEntries(Object.entries(value), depth, seen);
    } finally {
      seen.delete(value);
    }
  }

  /** Name and message, own fields such as `code`, `path` or `status`, then stack and cause; all redacted. */
  function walkError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
    const out: Record<string, unknown> = { name: error.name, message: redactText(error.message) };
    const own = Object.entries(error).filter(([key]) => !['name', 'message', 'stack', 'cause'].includes(key));
    Object.assign(out, walkEntries(own, depth, seen));
    if (error.stack) out['stack'] = redactText(error.stack);
    if (error.cause !== undefined) out['cause'] = walk(error.cause, depth + 1, seen);
    return out;
  }

  function walkArray(items: unknown[], depth: number, seen: WeakSet<object>): unknown[] {
    const out = items.slice(0, MAX_ARRAY_ITEMS).map((item) => walk(item, depth + 1, seen));
    if (items.length > MAX_ARRAY_ITEMS) out.push(`[${items.length - MAX_ARRAY_ITEMS} more]`);
    return out;
  }

  function walkEntries(entries: Array<[string, unknown]>, depth: number, seen: WeakSet<object>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, MAX_KEYS)) {
      if (isEnvName(key)) {
        out[key] = redactEnv(item);
      } else if (isSecretName(key)) {
        out[key] = hidesNothing(item) ? item : REDACTED;
      } else {
        out[key] = walk(item, depth + 1, seen);
      }
    }
    if (entries.length > MAX_KEYS) out['…'] = `${entries.length - MAX_KEYS} more keys`;
    return out;
  }

  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (isSecretName(name) && looksLikeToken(value)) addSecret(value);
  }

  return { addSecret, redactText, redactValue };
}

/**
 * Environment names are a loose signal (`AUTH_TYPE=interactive`, `SSH_AUTH_SOCK=/tmp/…`,
 * `GOOGLE_APPLICATION_CREDENTIALS=C:\keys\sa.json`), so only values shaped like a token are
 * registered: 16+ characters, no spaces, not a file path. Registering a word or a folder would
 * blank it out of every line in the log.
 */
function looksLikeToken(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 16 && !/\s/.test(trimmed) && !/^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(trimmed);
}

/** Values that cannot carry a secret are kept, so `hasToken: true` still reads. */
function hidesNothing(value: unknown): boolean {
  return value === null || value === undefined || value === '' || typeof value === 'number' || typeof value === 'boolean';
}

/** Keeps the variable names (useful when debugging a spawn) and drops every value. */
function redactEnv(env: unknown): unknown {
  if (Array.isArray(env)) {
    return env.map((entry) => (typeof entry === 'string' && entry.includes('=') ? `${entry.slice(0, entry.indexOf('='))}=${REDACTED}` : REDACTED));
  }
  if (env !== null && typeof env === 'object') {
    return Object.fromEntries(Object.keys(env).map((name) => [name, REDACTED]));
  }
  return hidesNothing(env) ? env : REDACTED;
}

interface HeadersLike {
  entries(): IterableIterator<[string, string]>;
  get(name: string): string | null;
  has(name: string): boolean;
}

function isHeadersLike(value: object): value is HeadersLike {
  return typeof Headers !== 'undefined' && value instanceof Headers;
}
