import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eventContracts, invokeContracts } from './schemas';

/**
 * Design §8 / AL-040: the renderer gets connection status, never a secret. Every invoke response
 * and every event payload is walked for field names that would carry one. Requests are not checked:
 * a save request legitimately carries the token the user typed, straight into the SecretStore.
 *
 * A field that must show part of a token uses the `masked` prefix (e.g. `maskedToken: '••••7Fq2'`).
 * A name that only looks secret (say an LLM `tokenCount`) goes in SAFE_FIELD_NAMES with a reason.
 */
const SAFE_FIELD_NAMES = new Set<string>([]);

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
  'bearer',
  'cookie',
]);
const SECRET_PAIRS = [
  ['api', 'key'],
  ['private', 'key'],
  ['access', 'key'],
] as const;

/** `maskedPat` → [masked, pat]; `ADO_PAT` → [ado, pat]; `apiKey` → [api, key]. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function isSecretFieldName(name: string): boolean {
  if (SAFE_FIELD_NAMES.has(name)) return false;
  const parts = words(name);
  if (parts[0] === 'masked') return false;
  if (parts.some((part) => SECRET_WORDS.has(part))) return true;
  return parts.some((part, index) => SECRET_PAIRS.some(([a, b]) => part === a && parts[index + 1] === b));
}

type JsonSchema = { [key: string]: unknown };

function isObject(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every property name reachable in a JSON Schema, with its path (`$.items[].apiKey`). */
function collectFieldNames(node: unknown, path: string, found: Array<{ name: string; path: string }>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collectFieldNames(child, path, found));
    return;
  }
  if (!isObject(node)) return;

  if (isObject(node['properties'])) {
    for (const [name, child] of Object.entries(node['properties'])) {
      found.push({ name, path: `${path}.${name}` });
      collectFieldNames(child, `${path}.${name}`, found);
    }
  }
  // Record keys fixed by an enum are field names too.
  const propertyNames = node['propertyNames'];
  if (isObject(propertyNames) && Array.isArray(propertyNames['enum'])) {
    for (const name of propertyNames['enum']) {
      if (typeof name === 'string') found.push({ name, path: `${path}.${name}` });
    }
  }
  for (const key of ['items', 'prefixItems', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'not']) {
    if (key in node) collectFieldNames(node[key], key === 'items' || key === 'prefixItems' ? `${path}[]` : path, found);
  }
  for (const key of ['$defs', 'definitions', 'patternProperties']) {
    const group = node[key];
    if (isObject(group)) Object.values(group).forEach((child) => collectFieldNames(child, path, found));
  }
}

function secretFieldsIn(schema: z.ZodType): string[] {
  // Output side: what actually crosses IPC. Transforms and other non-JSON types become `{}`.
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any', cycles: 'ref' });
  const found: Array<{ name: string; path: string }> = [];
  collectFieldNames(json, '$', found);
  return found.filter(({ name }) => isSecretFieldName(name)).map(({ path }) => path);
}

describe('secret field names', () => {
  it.each([
    'token',
    'accessToken',
    'refresh_token',
    'pat',
    'adoPat',
    'ADO_PAT',
    'apiKey',
    'api_key',
    'ANTHROPIC_API_KEY',
    'clientSecret',
    'password',
    'ciphertext',
    'credentials',
    'privateKey',
  ])('flags %s', (name) => {
    expect(isSecretFieldName(name)).toBe(true);
  });

  it.each(['path', 'worktreePath', 'patch', 'pattern', 'compatible', 'inputTokens', 'outputTokens', 'maskedToken', 'maskedPat', 'keyboard', 'monkey'])(
    'allows %s',
    (name) => {
      expect(isSecretFieldName(name)).toBe(false);
    },
  );

  it('finds secret fields however deeply they are nested', () => {
    const leaky = z.object({
      name: z.string(),
      rows: z.array(z.object({ org: z.string(), pat: z.string().optional() })),
      claude: z.union([z.object({ apiKey: z.string() }), z.null()]),
      byOrg: z.record(z.string(), z.object({ accessToken: z.string() })),
      tuple: z.tuple([z.object({ clientSecret: z.string() })]),
      lazy: z.lazy(() => z.object({ password: z.string() })),
      piped: z.object({ token: z.string() }).nullable().default(null),
      both: z.intersection(z.object({ a: z.string() }), z.object({ credentials: z.string() })),
      keyed: z.record(z.enum(['ok', 'secret']), z.string()),
    });

    expect(secretFieldsIn(leaky).sort()).toEqual(
      [
        '$.rows[].pat',
        '$.claude.apiKey',
        '$.byOrg.accessToken',
        '$.tuple[].clientSecret',
        '$.lazy.password',
        '$.piped.token',
        '$.both.credentials',
        '$.keyed.secret',
      ].sort(),
    );
  });

  it('passes a status-only connection row', () => {
    const row = z.object({
      id: z.string(),
      kind: z.enum(['ado', 'claude', 'mcp']),
      identity: z.string().nullable(),
      expiresAt: z.string().nullable(),
      status: z.enum(['ok', 'error', 'untested']),
      maskedToken: z.string(),
    });
    expect(secretFieldsIn(z.array(row))).toEqual([]);
  });
});

describe('IPC contracts carry no secrets (AL-040)', () => {
  it.each(Object.entries(invokeContracts).map(([channel, contract]) => [channel, contract.response] as const))(
    'response of %s has no secret field',
    (_channel, response) => {
      expect(secretFieldsIn(response)).toEqual([]);
    },
  );

  it('event payloads have no secret field', () => {
    const leaks = Object.fromEntries(
      Object.entries(eventContracts)
        .map(([channel, payload]) => [channel, secretFieldsIn(payload as z.ZodType)] as const)
        .filter(([, fields]) => fields.length > 0),
    );
    expect(leaks).toEqual({});
  });
});
