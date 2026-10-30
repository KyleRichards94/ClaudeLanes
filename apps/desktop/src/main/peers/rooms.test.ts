import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok, peerRoomId, type PeerFrame, type PeerNetworkStatus, type TicketAdoRef } from '@agent-lanes/contracts';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets';
import { createMemoryRecordFs, newTicketInput } from '../tickets/testing';
import type { FrameDraft, PeerEvent, PeerNetwork } from './network';
import { recordingEmit } from '../agent/testing/sessions';
import { createRoomLog } from './room-log';
import { createRooms, type PortfolioParentRef, type Rooms } from './rooms';
import { createPeerLanes } from './service';
import { signFrame } from './signer';
import { TEST_TEAM } from './testing';
import { peerNetworkFixture } from '@agent-lanes/contracts/testing';

const BASE = join('C:', 'src');
const ME = { user: 'Mitch Healy', host: 'MITCH-PC', instance: randomUUID() };
const KYLE = { user: 'Kyle Richards', host: 'KYLE-PC', instance: randomUUID(), person: false };
const ORG = 'https://devops:8090/tfs/DefaultCollection';
const ROOM = peerRoomId(ORG, 48000);

interface FakeNetwork extends Pick<PeerNetwork, 'broadcast' | 'sendTo' | 'onFrame' | 'onPeer' | 'identity' | 'status'> {
  sent: Array<FrameDraft & { to?: string }>;
  deliver(frame: Omit<PeerFrame, 'sig' | 'v' | 'id' | 'team' | 'sentAt' | 'replay' | 'from'> & { from?: PeerFrame['from'] }): void;
  peer(event: PeerEvent): void;
}

function fakeNetwork(): FakeNetwork {
  const frames = new Set<(frame: PeerFrame) => void>();
  const peers = new Set<(event: PeerEvent) => void>();
  const status: PeerNetworkStatus = peerNetworkFixture({ listener: { state: 'listening', port: 47811, message: null } });
  const sent: FakeNetwork['sent'] = [];
  return {
    sent,
    broadcast(draft) {
      sent.push(draft);
      return null;
    },
    sendTo(to, draft) {
      sent.push({ ...draft, to });
      return true;
    },
    onFrame(listener) {
      frames.add(listener);
      return () => frames.delete(listener);
    },
    onPeer(listener) {
      peers.add(listener);
      return () => peers.delete(listener);
    },
    identity: () => ME,
    status: () => status,
    deliver(partial) {
      const frame = signFrame({ v: 1, id: randomUUID(), team: TEST_TEAM.tag, sentAt: new Date().toISOString(), replay: false, from: KYLE, ...partial }, TEST_TEAM.key);
      for (const listen of frames) listen(frame);
    },
    peer(event) {
      for (const listen of peers) listen(event);
    },
  };
}

const parents: Record<string, PortfolioParentRef | null> = {
  [`${ORG}#48162`]: { id: 48000, type: 'Feature', title: 'Job DTO' },
  [`https://dev.azure.com/contoso#71273`]: { id: 48000, type: 'Feature', title: 'Other org, same id' },
  [`${ORG}#48300`]: null,
};

let rooms: Rooms | undefined;
afterEach(() => rooms?.dispose());

async function setup(options: { touched?: () => string[]; presenceMs?: number; expiryMs?: number; now?: () => number } = {}) {
  const tickets: TicketRecordStore = createTicketRecordStore({ rootDir: join(BASE, 'tickets'), fs: createMemoryRecordFs(), warn: () => undefined });
  const network = fakeNetwork();
  const findParent = vi.fn(async (ado: TicketAdoRef) => {
    const key = `${ado.orgUrl}#${ado.workItemId}`;
    return key in parents ? ok(parents[key] ?? null) : err('INTERNAL', 'ADO is down');
  });
  rooms = createRooms({
    network,
    tickets,
    findParent,
    touched: async () => options.touched?.() ?? [],
    presenceMs: options.presenceMs ?? 60_000,
    expiryMs: options.expiryMs ?? 90_000,
    ...(options.now ? { now: options.now } : {}),
  });
  return { tickets, network, findParent, rooms };
}

function story(id: number, orgUrl = ORG) {
  return newTicketInput(BASE, { id: String(id), title: `Story ${id}`, ado: { orgUrl, project: 'OnSite Companion', workItemId: id }, branch: `${id}-story`, worktreePath: join(BASE, '.agent-lanes', String(id)) });
}

describe('rooms (AL-290)', () => {
  it("puts a story in its Feature's room, saves it on the record, and asks ADO once", async () => {
    const { tickets, rooms, findParent } = await setup();
    await tickets.create(story(48162));
    expect(await rooms.ensureRoom('48162')).toEqual({ id: ROOM, parentId: 48000, parentType: 'Feature', parentTitle: 'Job DTO' });
    expect((await tickets.get('48162'))?.room?.id).toBe(ROOM);
    await rooms.ensureRoom('48162');
    expect(findParent).toHaveBeenCalledTimes(1);
  });

  it('gives no room to a story with no parent, or a ticket with no work item, and keeps trying while ADO is down', async () => {
    const { tickets, rooms, findParent } = await setup();
    await tickets.create(story(48300));
    await tickets.create(newTicketInput(BASE, { id: 'nt-20261029-tidy', ado: null, branch: 'nt-tidy', worktreePath: join(BASE, '.agent-lanes', 'nt-20261029-tidy') }));
    await tickets.create(story(48999));
    expect(await rooms.ensureRoom('48300')).toBeNull();
    expect((await tickets.get('48300'))?.room).toBeNull();
    expect(await rooms.ensureRoom('nt-20261029-tidy')).toBeNull();
    expect(await rooms.ensureRoom('48999')).toBeNull();
    expect((await tickets.get('48999'))?.room).toBeUndefined();
    await rooms.ensureRoom('48999');
    expect(findParent).toHaveBeenCalledTimes(3);
  });

  it('never puts two organisations in one room', async () => {
    const { tickets, rooms } = await setup();
    await tickets.create(story(48162));
    await tickets.create(newTicketInput(BASE, { id: '71273', worktreePath: join(BASE, '.agent-lanes', '71273') }));
    const a = await rooms.ensureRoom('48162');
    const b = await rooms.ensureRoom('71273');
    expect(a?.parentId).toBe(b?.parentId);
    expect(a?.id).not.toBe(b?.id);
  });

  it('rejoins a lane rebuilt on start-up: hello in its room, then its touched files', async () => {
    const { tickets, rooms, network } = await setup({ touched: () => ['src/JobDto.cs'] });
    await tickets.create(story(48162));
    await tickets.update('48162', (record) => ({ ...record, room: { id: ROOM, parentId: 48000, parentType: 'Feature', parentTitle: 'Job DTO' } }));
    await rooms.sync();
    expect(network.sent.map((frame) => [frame.kind, frame.room])).toEqual([
      ['hello', ROOM],
      ['touched', ROOM],
    ]);
    expect(network.sent[1]?.data?.files).toEqual(['src/JobDto.cs']);
    expect(rooms.members(ROOM)).toEqual([expect.objectContaining({ local: true, user: 'Mitch Healy', touched: ['src/JobDto.cs'], lane: expect.objectContaining({ workItemId: 48162, parentId: 48000 }) })]);
  });

  it('sends touched files within one presence tick of an edit', async () => {
    let files: string[] = [];
    const { tickets, rooms, network } = await setup({ touched: () => files, presenceMs: 40 });
    await tickets.create(story(48162));
    rooms.start();
    await vi.waitFor(() => expect(network.sent.some((frame) => frame.kind === 'hello')).toBe(true));
    files = ['src/JobService.cs'];
    await vi.waitFor(() => expect(network.sent.find((frame) => frame.kind === 'touched')?.data?.files).toEqual(['src/JobService.cs']), { timeout: 1_000 });
  });

  it("keeps a peer's lane from its frames, marks it unreachable when its app goes, and drops it on expiry or bye", async () => {
    const { tickets, rooms, network } = await setup({ presenceMs: 20, expiryMs: 150 });
    await tickets.create(story(48162));
    await rooms.ensureRoom('48162');
    rooms.start();
    const lane = { ticketId: '48161', workItemId: 48161, title: 'Job DTO', stage: 'implementing', branch: '48161-job-dto', parentId: 48000 };
    network.deliver({ kind: 'hello', room: ROOM, lane, text: '', data: {} });
    network.deliver({ kind: 'touched', room: ROOM, lane, text: '', data: { files: ['src/JobDto.cs'] } });
    expect(rooms.members(ROOM).find((member) => !member.local)).toMatchObject({ user: 'Kyle Richards', touched: ['src/JobDto.cs'], reachable: true });

    network.peer({ instance: KYLE.instance, change: 'gone', reason: 'closed' });
    expect(rooms.members(ROOM).find((member) => !member.local)?.reachable).toBe(false);
    await vi.waitFor(() => expect(rooms.members(ROOM).some((member) => !member.local)).toBe(false), { timeout: 1_000 });

    network.deliver({ kind: 'status', room: ROOM, lane, text: '', data: {} });
    expect(rooms.members(ROOM)).toHaveLength(2);
    network.deliver({ kind: 'bye', room: ROOM, lane, text: '', data: {} });
    expect(rooms.members(ROOM)).toHaveLength(1);
  });

  it("lists a peer's lane in no room of this app's under others, for the team board", async () => {
    const { tickets, rooms, network } = await setup();
    await tickets.create(story(48162));
    await rooms.ensureRoom('48162');
    await rooms.sync();
    network.deliver({ kind: 'status', room: 'https://devops:8090/tfs/defaultcollection#50000', lane: { ticketId: '50001', workItemId: 50001, title: 'Elsewhere', stage: 'qa', branch: '50001-x', parentId: 50000 }, text: '', data: {} });
    const view = rooms.view();
    expect(view.rooms.map((room) => [room.id, room.members.length])).toEqual([[ROOM, 1]]);
    expect(view.others.map((member) => member.lane.workItemId)).toEqual([50001]);
  });

  it('says bye when a lane is done, and a second agent talks in its lead’s room', async () => {
    const { tickets, rooms, network } = await setup();
    await tickets.create(story(48162));
    await rooms.ensureRoom('48162');
    await rooms.sync();
    await tickets.create({ ...story(48162), id: '48162-reviewer-eyes', companion: { of: '48162', role: 'reviewer', name: 'Eyes' } } as never);
    expect((await rooms.roomFor('48162-reviewer-eyes'))?.id).toBe(ROOM);
    await tickets.update('48162', (record) => ({ ...record, stage: 'done', stageHistory: [...record.stageHistory, { stage: 'done', at: Date.now() }] }));
    await rooms.sync();
    expect(network.sent.at(-1)).toMatchObject({ kind: 'bye', room: ROOM });
    expect(rooms.members(ROOM)).toEqual([]);
  });
});

describe('rooms over two networks on loopback (AL-290)', () => {
  it("shows one app's lane, with its touched files, as a member of the room on the other", async () => {
    const { createTestPeer, freePort, testConfig } = await import('./testing');
    const a = createTestPeer('mitch', await freePort());
    const b = createTestPeer('kyle', await freePort());
    const room = { id: ROOM, parentId: 48000, parentType: 'Feature', parentTitle: 'Job DTO' };
    const made: Rooms[] = [];
    try {
      const sides = await Promise.all(
        [a, b].map(async (peer, index) => {
          const tickets = createTicketRecordStore({ rootDir: join(BASE, `tickets-${index}`), fs: createMemoryRecordFs(), warn: () => undefined });
          await tickets.create(story(48161 + index));
          await tickets.update(String(48161 + index), (record) => ({ ...record, room }));
          const side = createRooms({ network: peer.network, tickets, findParent: async () => ok(null), touched: async () => [`src/File${index}.cs`], presenceMs: 60_000 });
          made.push(side);
          return side;
        }),
      );
      await a.network.configure(testConfig(a.port, [`localhost:${b.port}`]));
      await b.network.configure(testConfig(b.port, [`localhost:${a.port}`]));
      await Promise.all(sides.map((side) => side.sync()));
      await vi.waitFor(() => expect(sides[1]?.members(ROOM).find((member) => !member.local)).toMatchObject({ user: 'mitch', lane: { workItemId: 48161 }, touched: ['src/File0.cs'] }), { timeout: 5_000 });
      await vi.waitFor(() => expect(sides[0]?.members(ROOM).find((member) => !member.local)).toMatchObject({ user: 'kyle', lane: { workItemId: 48162 }, touched: ['src/File1.cs'] }), { timeout: 5_000 });
    } finally {
      for (const side of made) side.dispose();
      await a.network.dispose();
      await b.network.dispose();
    }
  });
});

describe('the room as a chat room (AL-300)', () => {
  it("logs joined, left and lost-contact rows from hello, bye and expiry, for peers and this app's lanes, and never counts or sends them", async () => {
    let at = Date.parse('2026-10-30T10:42:00.000Z');
    const now = () => at;
    const dir = await mkdtemp(join(tmpdir(), 'agent-lanes-room-rows-'));
    try {
      const { tickets, rooms, network } = await setup({ presenceMs: 20, expiryMs: 90_000, now });
      const events = recordingEmit();
      const roomLog = createRoomLog({ dir, network, now });
      const peerLanes = createPeerLanes({
        network,
        rooms,
        roomLog,
        tickets,
        git: { status: async () => ok({}) } as never,
        sessions: { status: (ticketId) => ({ ticketId, state: 'idle', sessionId: null, message: null }) },
        wake: async () => ok({ held: false }),
        emit: events.emit,
        now,
      });
      await tickets.create(story(48162));
      await rooms.ensureRoom('48162');
      rooms.start();
      await rooms.sync();
      const kyle = { ticketId: '48161', workItemId: 48161, title: 'Job DTO', stage: 'implementing', branch: '48161-job-dto', parentId: 48000 };
      network.deliver({ kind: 'hello', room: ROOM, lane: kyle, text: '', data: {} });
      at += 60_000;
      network.deliver({ kind: 'bye', room: ROOM, lane: kyle, text: '', data: {} });
      network.deliver({ kind: 'hello', room: ROOM, lane: kyle, text: '', data: {} });
      expect(rooms.members(ROOM).map((member) => member.user)).toEqual(['Mitch Healy', 'Kyle Richards']);
      at += 91_000;
      await vi.waitFor(() => expect(rooms.members(ROOM).map((member) => member.user)).toEqual(['Mitch Healy']));

      const rows = (await roomLog.read(ROOM)).messages.filter((message) => message.system);
      expect(rows.map((row) => [row.system, row.from.user, row.lane?.workItemId, row.own, row.sentAt])).toEqual([
        ['joined', 'Mitch Healy', 48162, true, '2026-10-30T10:42:00.000Z'],
        ['joined', 'Kyle Richards', 48161, false, '2026-10-30T10:42:00.000Z'],
        ['left', 'Kyle Richards', 48161, false, '2026-10-30T10:43:00.000Z'],
        ['joined', 'Kyle Richards', 48161, false, '2026-10-30T10:43:00.000Z'],
        ['lost', 'Kyle Richards', 48161, false, '2026-10-30T10:44:31.000Z'],
      ]);
      // The renderer hears each one as it happens; none of them counts toward the Assist bubble.
      const messages = events.of('peers:message');
      expect(messages.map((event) => (event['message'] as { system?: string }).system)).toEqual(['joined', 'joined', 'left', 'joined', 'lost']);
      expect(messages.every((event) => (event['unread'] as { total: number }).total === 0)).toBe(true);
      expect(peerLanes.rooms().rooms[0]?.unread).toBe(0);
      // Never a frame, never replayed to a late joiner, and still there after a restart.
      expect(network.sent.map((draft) => draft.kind).every((kind) => ['hello', 'status', 'touched', 'bye'].includes(kind))).toBe(true);
      expect(await roomLog.replayTo(KYLE.instance, ROOM)).toBe(0);
      await roomLog.flush();
      const again = await createRoomLog({ dir, network, now }).read(ROOM);
      expect(again.messages.map((message) => message.system)).toEqual(['joined', 'joined', 'left', 'joined', 'lost']);
      await peerLanes.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
