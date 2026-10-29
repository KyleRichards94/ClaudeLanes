import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PeerFrameSchema, PeerTeamTagSchema, type PeerFrame, type PeerTeamTag, type UnsignedPeerFrame } from '@agent-lanes/contracts';

/**
 * Frame signing (AL-287, AL-298, PL§3, PL§11): HMAC-SHA256 over the canonical JSON of every field but
 * `sig`, with the key derived from the ADO organisation and project the frame's `team` tag names. A
 * frame is checked before the schema reads it; a bad one is only counted.
 */

export interface PeerTeamKey {
  tag: PeerTeamTag;
  /** In memory only: never stored, sent or logged. */
  key: Buffer;
  /** Lower case, no trailing slash: the organisation part of a room id. */
  orgUrl: string;
}

/** The same org URL and project id give the same tag and key on every computer. */
export function deriveTeam(orgUrl: string, projectId: string): PeerTeamKey {
  const org = orgUrl.trim().replace(/\/+$/, '').toLowerCase();
  const norm = `${org}\n${projectId.trim().toLowerCase()}`;
  const tag = createHash('sha256').update(`agent-lanes-peers/v1/tag\n${norm}`).digest('hex').slice(0, 16);
  const key = createHash('sha256').update(`agent-lanes-peers/v1/key\n${norm}`).digest();
  return { tag, key, orgUrl: org };
}

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

function hmac(fields: Record<string, unknown>, key: Buffer): string {
  return createHmac('sha256', key).update(canonicalJson(fields)).digest('hex');
}

export function signFrame(frame: UnsignedPeerFrame, key: Buffer): PeerFrame {
  return { ...frame, sig: hmac(frame, key) };
}

/** True when `value` carries a `sig` that matches the rest of it under `key`. Compared in constant time. */
export function verifySignature(value: unknown, key: Buffer): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const { sig, ...fields } = value as Record<string, unknown>;
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(hmac(fields, key), 'hex'), Buffer.from(sig, 'hex'));
}

export type OpenedFrame = { ok: true; frame: PeerFrame } | { ok: false; reason: 'json' | 'team' | 'signature' | 'schema' };

/**
 * A received message: JSON, then the key for its `team` tag, then the signature, then the schema.
 * Only the tag is read before the signature passes, to pick the key.
 */
export function openFrame(text: string, keyFor: (tag: PeerTeamTag) => Buffer | undefined): OpenedFrame {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  const tag = value !== null && typeof value === 'object' ? PeerTeamTagSchema.safeParse((value as { team?: unknown }).team) : null;
  const key = tag?.success ? keyFor(tag.data) : undefined;
  if (!key) return { ok: false, reason: 'team' };
  if (!verifySignature(value, key)) return { ok: false, reason: 'signature' };
  const parsed = PeerFrameSchema.safeParse(value);
  return parsed.success ? { ok: true, frame: parsed.data } : { ok: false, reason: 'schema' };
}
