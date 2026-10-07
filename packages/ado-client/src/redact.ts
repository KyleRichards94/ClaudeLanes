export const REDACTED = '[REDACTED]';

/** Any `Authorization` style credential, whoever's it is. */
const AUTH_SCHEME = /\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]+/gi;

export type Redactor = <T>(value: T) => T;

/**
 * Returns a function that removes the PAT, in every form the client puts on the wire, from a
 * string or from every string inside a plain object or array. Applied to each error message,
 * error details object and log entry before it leaves the client.
 */
export function createRedactor(pat: string, authorizationHeader: string): Redactor {
  const encodedPat = authorizationHeader.replace(/^Basic\s+/i, '');
  // The header itself is `Basic <encodedPat>`, so it becomes `Basic [REDACTED]`.
  const secrets = [...new Set([encodedPat, pat, encodeURIComponent(pat), btoa(pat)])]
    .filter((secret) => secret.length > 0)
    // Longest first, so a longer form goes before any part of it.
    .sort((a, b) => b.length - a.length);

  const redactString = (text: string): string => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join(REDACTED);
    return out.replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  };

  const redactValue = (value: unknown, seen: WeakSet<object>): unknown => {
    if (typeof value === 'string') return redactString(value);
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
    if (value instanceof Error) return redactString(`${value.name}: ${value.message}`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, seen)]));
  };

  return <T>(value: T): T => redactValue(value, new WeakSet()) as T;
}
