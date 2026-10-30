import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, type PeerFrame, type PeerKind, type UnsignedPeerFrame } from '@agent-lanes/contracts';
import { createTicketRecordStore } from '../tickets';
import { createMemoryRecordFs, newTicketInput } from '../tickets/testing';
import type { FrameDraft } from './network';
import { OWN_LOG_MAX, createRoomLog, roomLogFile } from './room-log';
import { createRooms, type Rooms } from './rooms';
import { createPeerLanes } from './service';
import { signFrame } from './signer';
import { TEST_ROOM, TEST_TEAM, createTestPeer, freePort, testConfig, testLane } from './testing';

const OTHER_ROOM = 'https://devops:8090/tfs/defaultcollection#50000';
const ME = { user: 'Mitch Healy', host: 'MITCH-PC', instance: randomUUID(), person: false };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-room-log-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

function frame(text: string, overrides: Partial<UnsignedPeerFrame> = {}, kind: PeerKind = 'ask'): PeerFrame {
  return signFrame({ v: 1, id: randomUUID(), room: TEST_ROOM, team: TEST_TEAM.tag, kind, from: ME, lane: testLane(48162), text, data: {}, sentAt: new Date().toISOString(), replay: false, ...overrides }, TEST_TEAM.key);
}

function store(now?: () => number, sent: Array<{ to: string; draft: FrameDraft }> = []) {
  return createRoomLog({ dir, network: { sendTo: (to, draft) => (sent.push({ to, draft }), true) }, ...(now ? { now } : {}) });
}

describe('room log (AL-291)', () => {
  it('keeps own messages on disk with no signature or key, and reads them back after a restart', async () => {
    const first = store();
    await first.recordOwn(frame('Pushed JobDto.Status on 48162-job-dto'));
    await first.recordOwn(frame('Need the enum from #48161', {}, 'blocked'));
    await first.flush();
    const text = await readFile(roomLogFile(dir, TEST_ROOM), 'utf8');
    expect(text).not.toContain(TEST_TEAM.key.toString('hex'));
    expect(text).not.toContain('"sig"');
    expect(await readdir(dir)).toEqual([roomLogFile(dir, TEST_ROOM).slice(dir.length + 1)]);

    const again = await store().read(TEST_ROOM);
    expect(again.messages.map((message) => [message.kind, message.text, message.own])).toEqual([
      ['ask', 'Pushed JobDto.Status on 48162-job-dto', true],
      ['blocked', 'Need the enum from #48161', true],
    ]);
    expect(again.capped).toBe(false);
  });

  it('keeps the last 200 own messages and says the log is capped', async () => {
    const log = store();
    for (let n = 1; n <= OWN_LOG_MAX + 5; n += 1) await log.recordOwn(frame(`Message ${n}`, { sentAt: new Date(Date.now() - (OWN_LOG_MAX + 5 - n) * 1_000).toISOString() }));
    await log.flush();
    const reread = await store().read(TEST_ROOM);
    expect(reread.messages).toHaveLength(OWN_LOG_MAX);
    expect(reread.messages[0]?.text).toBe('Message 6');
    expect(reread.capped).toBe(true);
  });

  it('drops own messages older than 7 days', async () => {
    const old = frame('Last week', { sentAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString() });
    const log = store();
    await log.recordOwn(old);
    await log.recordOwn(frame('Today'));
    await log.flush();
    expect((await store().read(TEST_ROOM)).messages.map((message) => message.text)).toEqual(['Today']);
  });

  it('keeps joins out of the log; they are presence', async () => {
    const log = store();
    await log.recordOwn(frame('', {}, 'hello'));
    expect(log.recordReceived(frame('', { from: { ...ME, instance: randomUUID() } }, 'hello'))).toBe(false);
    expect((await log.read(TEST_ROOM)).messages).toEqual([]);
  });

  it('replays own messages for one room only, oldest first, marked replay, with a person’s post kept as theirs', async () => {
    const sent: Array<{ to: string; draft: FrameDraft }> = [];
    const log = store(undefined, sent);
    const first = frame('First');
    await log.recordOwn(first);
    await log.recordOwn(frame('Elsewhere', { room: OTHER_ROOM }));
    await log.recordOwn(frame('From the person', { from: { ...ME, user: 'Mitch Healy', person: true }, lane: null }));
    expect(await log.replayTo('kyle-instance', TEST_ROOM)).toBe(2);
    expect(sent.map(({ to, draft }) => [to, draft.text, draft.replay, draft.person])).toEqual([
      ['kyle-instance', 'First', true, undefined],
      ['kyle-instance', 'From the person', true, 'Mitch Healy'],
    ]);
    expect(sent[0]?.draft).toMatchObject({ id: first.id, sentAt: first.sentAt, room: TEST_ROOM });
  });
});

describe('late joiner over two networks (AL-291)', () => {
  it('gets every message the other app sent in its room, in order, marked replay, and none from other rooms', async () => {
    const a = createTestPeer('mitch', await freePort());
    const b = createTestPeer('kyle', await freePort());
    const made: Rooms[] = [];
    const lanes: Array<{ dispose(): void | Promise<void> }> = [];
    try {
      const side = async (peer: typeof a, index: number, rooms: Array<{ id: string; parentId: number }>) => {
        const tickets = createTicketRecordStore({ rootDir: join(dir, `tickets-${index}`), fs: createMemoryRecordFs(), warn: () => undefined });
        for (const [at, room] of rooms.entries()) {
          const id = String(48161 + index * 10 + at);
          await tickets.create(newTicketInput(dir, { id, ado: { orgUrl: 'https://devops:8090/tfs/DefaultCollection', project: 'P', workItemId: Number(id) }, branch: `${id}-x`, worktreePath: join(dir, id) }));
          await tickets.update(id, (record) => ({ ...record, room: { id: room.id, parentId: room.parentId, parentType: 'Feature', parentTitle: 'F' } }));
        }
        const rooms_ = createRooms({ network: peer.network, tickets, findParent: async () => ok(null), touched: async () => [], presenceMs: 60_000 });
        const roomLog = createRoomLog({ dir: join(dir, `log-${index}`), network: peer.network });
        made.push(rooms_);
        lanes.push(
          createPeerLanes({
            network: peer.network,
            rooms: rooms_,
            roomLog,
            tickets,
            git: { status: async () => ({ branch: null, entries: [], stash: null }) },
            sessions: { status: (ticketId) => ({ ticketId, state: 'stopped', sessionId: null, message: null }) },
            wake: async () => ok({ held: false }),
          }),
        );
        return { rooms: rooms_, roomLog, tickets };
      };
      const mitch = await side(a, 0, [
        { id: TEST_ROOM, parentId: 48000 },
        { id: OTHER_ROOM, parentId: 50000 },
      ]);
      await a.network.configure(testConfig(a.port, [`localhost:${b.port}`]));
      await mitch.rooms.sync();
      for (const [text, room] of [['One', TEST_ROOM], ['Two', TEST_ROOM], ['Not yours', OTHER_ROOM], ['Three', TEST_ROOM]] as const) {
        const sent = a.network.broadcast({ kind: 'ask', room, lane: testLane(48161), text });
        if (sent) await mitch.roomLog.recordOwn(sent);
      }

      // Kyle starts later with a lane in the first room only.
      const kyle = await side(b, 1, [{ id: TEST_ROOM, parentId: 48000 }]);
      await b.network.configure(testConfig(b.port, [`localhost:${a.port}`]));
      await kyle.rooms.sync();
      await vi.waitFor(async () => expect((await kyle.roomLog.read(TEST_ROOM)).messages.map((message) => message.text)).toEqual(['One', 'Two', 'Three']), { timeout: 8_000 });
      const read = await kyle.roomLog.read(TEST_ROOM);
      expect(read.messages.every((message) => message.replay && !message.own && message.from.user === 'mitch')).toBe(true);
      expect((await kyle.roomLog.read(OTHER_ROOM)).messages).toEqual([]);
    } finally {
      for (const item of [...lanes, ...made]) await item.dispose();
      await a.network.dispose();
      await b.network.dispose();
    }
  }, 15_000);
});
