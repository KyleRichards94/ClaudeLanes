import { createHmac, timingSafeEqual } from 'node:crypto';
import { PeerFrameSchema, type PeerFrame, type UnsignedPeerFrame } from '@agent-lanes/contracts';

/**
 * Frame signing (AL-287, PL§3, PL§7): HMAC-SHA256 with the team secret over the canonical JSON of
 * every field but `sig`. A frame is checked before the schema reads it; a bad one is only counted.
 */

/** JSON with object keys sorted at every level and `undefined` fields left out, so both ends hash the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hmac(fields: Record<string, unknown>, secret: string): string {
  return createHmac('sha256', secret).update(canonicalJson(fields)).digest('hex');
}

export function signFrame(frame: UnsignedPeerFrame, secret: string): PeerFrame {
  return { ...frame, sig: hmac(frame, secret) };
}

/** True when `value` carries a `sig` that matches the rest of it under `secret`. Compared in constant time. */
export function verifySignature(value: unknown, secret: string): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { sig, ...fields } = value as Record<string, unknown>;
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(hmac(fields, secret), 'hex'), Buffer.from(sig, 'hex'));
}

export type OpenedFrame = { ok: true; frame: PeerFrame } | { ok: false; reason: 'json' | 'signature' | 'schema' };

/** A received message: JSON, then the signature, then the schema. Nothing reads a field before the signature passes. */
export function openFrame(text: string, secret: string): OpenedFrame {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (!verifySignature(value, secret)) return { ok: false, reason: 'signature' };
  const parsed = PeerFrameSchema.safeParse(value);
  return parsed.success ? { ok: true, frame: parsed.data } : { ok: false, reason: 'schema' };
}
