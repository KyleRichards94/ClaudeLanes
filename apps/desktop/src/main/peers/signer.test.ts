import { describe, expect, it } from 'vitest';
import type { UnsignedPeerFrame } from '@agent-lanes/contracts';
import { canonicalJson, openFrame, signFrame, verifySignature } from './signer';

const frame: UnsignedPeerFrame = {
  v: 1,
  id: '6f1c2b0e-3d4a-4b5c-8d6e-7f8091a2b3c4',
  room: 'https://devops:8090/tfs/defaultcollection#48000',
  kind: 'changed',
  from: { user: 'Kyle Richards', host: 'KYLE-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: false },
  lane: { ticketId: '48161', workItemId: 48161, title: 'Job DTO', stage: 'implementing', branch: '48161-job-dto', parentId: 48000 },
  text: 'Added JobDto.Status',
  data: { files: ['src/JobDto.cs', 'src/JobService.cs'], branch: '48161-job-dto' },
  sentAt: '2026-10-29T03:14:00.000Z',
  replay: false,
};

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
  it('opens a frame signed with the same secret', () => {
    const signed = signFrame(frame, 'team-secret');
    expect(openFrame(JSON.stringify(signed), 'team-secret')).toEqual({ ok: true, frame: signed });
  });

  it('fails with another secret', () => {
    const signed = signFrame(frame, 'team-secret');
    expect(openFrame(JSON.stringify(signed), 'other-secret')).toEqual({ ok: false, reason: 'signature' });
  });

  it('fails when any byte of the signed fields changes', () => {
    const text = JSON.stringify(signFrame(frame, 'team-secret'));
    const sigAt = text.indexOf('"sig"');
    for (let at = 0; at < sigAt; at += 1) {
      const code = text.charCodeAt(at);
      if (code < 0x30 || code > 0x7a) continue;
      const tampered = `${text.slice(0, at)}${String.fromCharCode(code === 0x30 ? 0x31 : code - 1)}${text.slice(at + 1)}`;
      expect(openFrame(tampered, 'team-secret').ok, `byte ${at}`).toBe(false);
    }
  });

  it('fails when the signature changes', () => {
    const signed = signFrame(frame, 'team-secret');
    const sig = `${signed.sig.slice(0, -1)}${signed.sig.endsWith('0') ? '1' : '0'}`;
    expect(verifySignature({ ...signed, sig }, 'team-secret')).toBe(false);
  });

  it('checks the signature before the schema', () => {
    const unsigned = JSON.stringify({ ...frame, kind: 'shout' });
    expect(openFrame(unsigned, 'team-secret')).toEqual({ ok: false, reason: 'signature' });
    const signedButBad = JSON.stringify(signFrame({ ...frame, kind: 'shout' } as unknown as UnsignedPeerFrame, 'team-secret'));
    expect(openFrame(signedButBad, 'team-secret')).toEqual({ ok: false, reason: 'schema' });
  });

  it('treats text that is not JSON, or has no signature, as a dropped frame', () => {
    expect(openFrame('{not json', 'team-secret')).toEqual({ ok: false, reason: 'json' });
    expect(openFrame(JSON.stringify(frame), 'team-secret')).toEqual({ ok: false, reason: 'signature' });
    expect(openFrame('[]', 'team-secret')).toEqual({ ok: false, reason: 'signature' });
  });
});
