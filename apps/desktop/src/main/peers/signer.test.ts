import { describe, expect, it } from 'vitest';
import type { UnsignedPeerFrame } from '@agent-lanes/contracts';
import { canonicalJson, deriveTeam, openFrame, signFrame, verifySignature } from './signer';

const ORG = 'https://devops:8090/tfs/DefaultCollection';
const PROJECT = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
const team = deriveTeam(ORG, PROJECT);
const other = deriveTeam(ORG, '0f7a4c2e-1b3d-4e5f-8a6b-9c0d1e2f3a4b');
const keys = (...known: Array<ReturnType<typeof deriveTeam>>) => (tag: string) => known.find((item) => item.tag === tag)?.key;

const frame: UnsignedPeerFrame = {
  v: 1,
  id: '6f1c2b0e-3d4a-4b5c-8d6e-7f8091a2b3c4',
  room: 'https://devops:8090/tfs/defaultcollection#48000',
  team: team.tag,
  kind: 'changed',
  from: { user: 'Kyle Richards', host: 'KYLE-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: false },
  lane: { ticketId: '48161', workItemId: 48161, title: 'Job DTO', stage: 'implementing', branch: '48161-job-dto', parentId: 48000 },
  text: 'Added JobDto.Status',
  data: { files: ['src/JobDto.cs', 'src/JobService.cs'], branch: '48161-job-dto' },
  sentAt: '2026-10-29T03:14:00.000Z',
  replay: false,
};

describe('deriveTeam (AL-298)', () => {
  it('gives two apps with the same org URL and project id the same tag and key', () => {
    const elsewhere = deriveTeam('https://DEVOPS:8090/tfs/defaultcollection/', PROJECT.toUpperCase());
    expect(elsewhere.tag).toBe(team.tag);
    expect(elsewhere.key.equals(team.key)).toBe(true);
    expect(team.tag).toMatch(/^[0-9a-f]{16}$/);
    expect(team.orgUrl).toBe('https://devops:8090/tfs/defaultcollection');
  });

  it('gives another project or organisation another tag and key', () => {
    const otherOrg = deriveTeam('https://dev.azure.com/contoso', PROJECT);
    expect(new Set([team.tag, other.tag, otherOrg.tag]).size).toBe(3);
    expect(team.key.equals(other.key)).toBe(false);
  });

  it('does not use the tag as the key', () => {
    expect(team.key.toString('hex').startsWith(team.tag)).toBe(false);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"x":2,"y":1}]},"b":1}');
  });

  it('gives the same string for the same object in any key order', () => {
    const shuffled = Object.fromEntries(Object.entries(frame).reverse());
    expect(canonicalJson(shuffled)).toBe(canonicalJson(frame));
  });
});

describe('signFrame and openFrame', () => {
  it('opens a frame signed on another app with the same org URL and project id', () => {
    const signed = signFrame(frame, deriveTeam(`${ORG}/`, PROJECT).key);
    expect(openFrame(JSON.stringify(signed), keys(team))).toEqual({ ok: true, frame: signed });
  });

  it('drops a frame whose team tag this app has no key for, before the signature', () => {
    const signed = signFrame({ ...frame, team: other.tag }, other.key);
    expect(openFrame(JSON.stringify(signed), keys(team))).toEqual({ ok: false, reason: 'team' });
    expect(openFrame(JSON.stringify({ ...signed, team: 'not-a-tag' }), keys(team))).toEqual({ ok: false, reason: 'team' });
  });

  it("fails a frame signed with another team's key under this team's tag", () => {
    const signed = signFrame(frame, other.key);
    expect(openFrame(JSON.stringify(signed), keys(team, other))).toEqual({ ok: false, reason: 'signature' });
  });

  it('fails when any byte of the signed fields changes', () => {
    const text = JSON.stringify(signFrame(frame, team.key));
    const sigAt = text.indexOf('"sig"');
    for (let at = 0; at < sigAt; at += 1) {
      const code = text.charCodeAt(at);
      if (code < 0x30 || code > 0x7a) continue;
      const tampered = `${text.slice(0, at)}${String.fromCharCode(code === 0x30 ? 0x31 : code - 1)}${text.slice(at + 1)}`;
      expect(openFrame(tampered, keys(team)).ok, `byte ${at}`).toBe(false);
    }
  });

  it('fails when the signature changes', () => {
    const signed = signFrame(frame, team.key);
    const sig = `${signed.sig.slice(0, -1)}${signed.sig.endsWith('0') ? '1' : '0'}`;
    expect(verifySignature({ ...signed, sig }, team.key)).toBe(false);
  });

  it('checks the signature before the schema', () => {
    const unsigned = JSON.stringify({ ...frame, kind: 'shout' });
    expect(openFrame(unsigned, keys(team))).toEqual({ ok: false, reason: 'signature' });
    const signedButBad = JSON.stringify(signFrame({ ...frame, kind: 'shout' } as unknown as UnsignedPeerFrame, team.key));
    expect(openFrame(signedButBad, keys(team))).toEqual({ ok: false, reason: 'schema' });
  });

  it('treats text that is not JSON, or has no tag or signature, as a dropped frame', () => {
    expect(openFrame('{not json', keys(team))).toEqual({ ok: false, reason: 'json' });
    expect(openFrame(JSON.stringify(frame), keys(team))).toEqual({ ok: false, reason: 'signature' });
    expect(openFrame('[]', keys(team))).toEqual({ ok: false, reason: 'team' });
    expect(openFrame('null', keys(team))).toEqual({ ok: false, reason: 'team' });
  });
});
