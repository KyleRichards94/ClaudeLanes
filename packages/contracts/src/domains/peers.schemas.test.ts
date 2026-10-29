import { describe, expect, it } from 'vitest';
import {
  PEER_KINDS,
  PEER_POST_KINDS,
  PEER_TEXT_MAX,
  PeerFrameSchema,
  RoomMessageSchema,
  UnsignedPeerFrameSchema,
  isPeerPostKind,
  peerRoomId,
  type PeerKind,
} from './peers.schemas';

const SIG = 'a'.repeat(64);

function frame(kind: PeerKind, overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    id: '6f1c2b0e-3d4a-4b5c-8d6e-7f8091a2b3c4',
    room: 'https://devops:8090/tfs/defaultcollection#48000',
    kind,
    from: { user: 'Kyle Richards', host: 'KYLE-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: false },
    lane: { ticketId: '48162', workItemId: 48162, title: 'Job DTO', stage: 'implementing', branch: '48162-job-dto', parentId: 48000 },
    text: isPeerPostKind(kind) ? 'Pushed JobDto.Status' : '',
    data: kind === 'touched' ? { files: ['src/JobDto.cs'] } : {},
    sentAt: '2026-10-29T03:14:00Z',
    replay: false,
    sig: SIG,
    ...overrides,
  };
}

describe('PeerFrameSchema', () => {
  it.each(PEER_KINDS)('round-trips a %s frame', (kind) => {
    const sent = frame(kind);
    const parsed = PeerFrameSchema.parse(JSON.parse(JSON.stringify(sent)));
    expect(parsed).toEqual(sent);
  });

  it('rejects an unknown kind', () => {
    expect(PeerFrameSchema.safeParse(frame('ask', { kind: 'shout' })).success).toBe(false);
  });

  it('rejects text over the limit', () => {
    expect(PeerFrameSchema.safeParse(frame('ask', { text: 'x'.repeat(PEER_TEXT_MAX) })).success).toBe(true);
    expect(PeerFrameSchema.safeParse(frame('ask', { text: 'x'.repeat(PEER_TEXT_MAX + 1) })).success).toBe(false);
  });

  it('rejects a frame with no signature or a malformed one', () => {
    const { sig: _sig, ...unsigned } = frame('ask');
    expect(PeerFrameSchema.safeParse(unsigned).success).toBe(false);
    expect(PeerFrameSchema.safeParse(frame('ask', { sig: 'not-hex' })).success).toBe(false);
    expect(UnsignedPeerFrameSchema.safeParse(unsigned).success).toBe(true);
  });

  it('keeps status, touched and bye free of text', () => {
    for (const kind of ['status', 'touched', 'bye'] as const) {
      expect(PeerFrameSchema.safeParse(frame(kind, { text: 'hi' })).success).toBe(false);
    }
  });

  it.each(PEER_POST_KINDS)('needs text and a room for %s', (kind) => {
    expect(PeerFrameSchema.safeParse(frame(kind, { text: '  ' })).success).toBe(false);
    expect(PeerFrameSchema.safeParse(frame(kind, { room: null })).success).toBe(false);
  });

  it('rejects another protocol version', () => {
    expect(PeerFrameSchema.safeParse(frame('hello', { v: 2 })).success).toBe(false);
  });
});

describe('RoomMessageSchema', () => {
  it('never carries the signature to the renderer', () => {
    const message = RoomMessageSchema.parse({ ...frame('ask'), own: true });
    expect(message).not.toHaveProperty('sig');
  });
});

describe('peerRoomId', () => {
  it('keys a room by organisation and parent', () => {
    expect(peerRoomId('https://devops:8090/tfs/DefaultCollection/', 48000)).toBe('https://devops:8090/tfs/defaultcollection#48000');
    expect(peerRoomId('https://dev.azure.com/contoso', 48000)).not.toBe(peerRoomId('https://dev.azure.com/fabrikam', 48000));
  });
});
