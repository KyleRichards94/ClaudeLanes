import { describe, expect, it } from 'vitest';
import type { RoomMessage } from '@agent-lanes/contracts';
import { AT_BOTTOM_PX, arrivals, atBottom, newMessagesLabel } from './follow';

const metrics = (offset: number) => ({ contentOffset: { y: offset }, contentSize: { height: 1_000 }, layoutMeasurement: { height: 400 } });

function row(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    v: 1,
    id: crypto.randomUUID(),
    room: 'https://dev.azure.com/contoso#48000',
    kind: 'ask',
    from: { user: 'Kyle Richards', host: 'KYLE-PC', instance: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: false },
    lane: null,
    text: 'Who has the mapper?',
    data: {},
    sentAt: '2026-10-30T10:42:00.000Z',
    replay: false,
    own: false,
    ...overrides,
  };
}

describe('following the log (AL-301)', () => {
  it('counts a few pixels short of the end as the bottom', () => {
    expect(atBottom(metrics(600))).toBe(true);
    expect(atBottom(metrics(600 - AT_BOTTOM_PX))).toBe(true);
    expect(atBottom(metrics(600 - AT_BOTTOM_PX - 1))).toBe(false);
  });

  it('follows new rows at the bottom, and counts only posts when scrolled up', () => {
    expect(arrivals([row()], true)).toEqual({ follow: true, unseen: 0 });
    expect(arrivals([row(), row()], false)).toEqual({ follow: false, unseen: 2 });
    expect(arrivals([row({ system: 'joined', kind: 'hello', text: '' })], false)).toEqual({ follow: false, unseen: 0 });
  });

  it("always follows the person's own post", () => {
    expect(arrivals([row({ own: true, from: { user: 'Mitch Healy', host: 'MITCH-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: true } })], false)).toEqual({ follow: true, unseen: 0 });
    expect(arrivals([row({ own: true })], false)).toEqual({ follow: false, unseen: 1 });
  });

  it('says New messages, with the count once there is more than one', () => {
    expect(newMessagesLabel(1)).toBe('New messages');
    expect(newMessagesLabel(3)).toBe('3 new messages');
  });
});
