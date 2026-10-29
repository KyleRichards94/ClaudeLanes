import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerFrame, PeerNetworkStatus, RoomMember, TicketRoom } from '@agent-lanes/contracts';
import { createGitService } from '../git';
import { createTempRepo, type TempRepo } from '../git/testing';
import { createTicketRecordStore } from '../tickets';
import { createMemoryRecordFs, newTicketInput } from '../tickets/testing';
import type { FrameDraft } from './network';
import { POST_EVERY_MS, createPeerPosting, describePeers } from './posting';
import { createRoomLog } from './room-log';
import { signFrame } from './signer';
import { TEST_ROOM, TEST_TEAM, testLane } from './testing';
import { peerNetworkFixture } from '@agent-lanes/contracts/testing';

const ME = { user: 'Mitch Healy', host: 'MITCH-PC', instance: randomUUID() };
const ROOM: TicketRoom = { id: TEST_ROOM, parentId: 48000, parentType: 'Feature', parentTitle: 'Job DTO' };

let repo: TempRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

function fakeNetwork(state: PeerNetworkStatus['listener']['state'] = 'listening') {
  const sent: PeerFrame[] = [];
  return {
    sent,
    status: (): PeerNetworkStatus => peerNetworkFixture({ listener: { state, port: 47811, message: null } }),
    identity: () => ME,
    broadcast(draft: FrameDraft) {
      const frame = signFrame(
        { v: 1, id: randomUUID(), room: draft.room, team: TEST_TEAM.tag, kind: draft.kind, from: { ...ME, user: draft.person ?? ME.user, person: draft.person !== undefined }, lane: draft.lane, text: draft.text ?? '', data: draft.data ?? {}, sentAt: new Date().toISOString(), replay: false },
        TEST_TEAM.key,
      );
      sent.push(frame);
      return frame;
    },
  };
}

async function setup(options: { room?: TicketRoom | null; listener?: PeerNetworkStatus['listener']['state'] } = {}) {
  repo = await createTempRepo();
  const worktree = await repo.addWorktree('48162-job-dto');
  const tickets = createTicketRecordStore({ rootDir: join(repo.root, 'tickets'), fs: createMemoryRecordFs(), warn: () => undefined });
  await tickets.create(newTicketInput(repo.root, { id: '48162', ado: { orgUrl: 'https://devops:8090/tfs/DefaultCollection', project: 'P', workItemId: 48162 }, branch: '48162-job-dto', worktreePath: worktree }));
  await tickets.update('48162', (record) => ({ ...record, room: options.room === undefined ? ROOM : options.room }));
  const network = fakeNetwork(options.listener);
  const delivery = { received: vi.fn(), noted: vi.fn(), unread: () => ({ total: 0, byRoom: {}, byTicket: {} }) };
  let clock = 1_000_000;
  const posting = createPeerPosting({
    network,
    rooms: {
      roomFor: async () => ROOM,
      ensureRoom: async () => ROOM,
      members: () => [],
      // Only whether the list is empty matters to posting.
      localIn: (room) => (room === TEST_ROOM ? ([{}] as never[]) : []),
    },
    roomLog: createRoomLog({ dir: join(repo.root, 'rooms'), network: { sendTo: () => true } }),
    delivery,
    tickets,
    git: createGitService({ runner: repo.git }),
    now: () => clock,
  });
  return { posting, network, delivery, worktree, tickets, tick: (ms: number) => (clock += ms) };
}

describe('post_to_room (AL-292)', () => {
  it('refuses changed until the ticket branch is pushed, then sends it with the branch and files', async () => {
    const { posting, network, worktree, tick } = await setup();
    await repo!.write('src/JobDto.cs', 'class JobDto {}', worktree);
    await repo!.commit('JobDto', worktree);
    const input = { kind: 'changed' as const, text: 'Added JobDto.Status', files: ['src/JobDto.cs'] };

    expect(await posting.agentPost('48162', input)).toMatchObject({ ok: false, message: 'Push 48162-job-dto first: it has no upstream yet.' });
    await repo!.exec(['push', '--quiet', '-u', 'origin', '48162-job-dto'], worktree);
    expect(await posting.agentPost('48162', input)).toMatchObject({ ok: true });
    expect(network.sent.at(-1)).toMatchObject({ kind: 'changed', room: TEST_ROOM, text: 'Added JobDto.Status', data: { branch: '48162-job-dto', files: ['src/JobDto.cs'] }, lane: { workItemId: 48162 } });

    tick(POST_EVERY_MS + 1);
    await repo!.write('src/JobService.cs', 'class JobService {}', worktree);
    await repo!.commit('JobService', worktree);
    expect(await posting.agentPost('48162', input)).toMatchObject({ ok: false, message: 'Push 48162-job-dto first: 1 commit is not on the remote yet.' });
    await repo!.exec(['push', '--quiet'], worktree);
    expect(await posting.agentPost('48162', input)).toMatchObject({ ok: true });
    expect(network.sent.filter((frame) => frame.kind === 'changed')).toHaveLength(2);
  }, 60_000);

  it('takes one post every 20 s per lane, except answer, and logs and delivers each locally but not to the poster', async () => {
    const { posting, network, delivery, tick } = await setup();
    expect((await posting.agentPost('48162', { kind: 'ask', text: 'Status?' })).ok).toBe(true);
    tick(5_000);
    expect(await posting.agentPost('48162', { kind: 'offer', text: 'I can take the mapper' })).toMatchObject({ ok: false, message: 'One post every 20 s per lane: wait 15 s, then post again.' });
    expect((await posting.agentPost('48162', { kind: 'answer', text: 'enum is JobStatus', to: { user: 'Kyle Richards', workItemId: 48161 } })).ok).toBe(true);
    tick(15_001);
    expect((await posting.agentPost('48162', { kind: 'offer', text: 'I can take the mapper' })).ok).toBe(true);
    expect(network.sent.map((frame) => frame.kind)).toEqual(['ask', 'answer', 'offer']);
    expect(delivery.received).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ask' }), '48162');
    expect(await posting.readRoom('48162')).toMatchObject({ ok: true, data: expect.stringContaining('ask: "Status?"') });
  }, 60_000);

  it('says why there is no room, in words the agent can read', async () => {
    const none = await setup({ room: null });
    expect(await none.posting.listPeers('48162')).toMatchObject({ ok: false, message: 'No room: #48162 has no parent Feature or Epic.' });
    await repo?.cleanup();
    repo = undefined;
    const off = await setup({ listener: 'off' });
    expect(await off.posting.agentPost('48162', { kind: 'ask', text: 'hi' })).toMatchObject({ ok: false, message: 'Peer lanes is off: there is no Peers connection in Connections.' });
  }, 60_000);

  it('posts a person’s message as the person, with no lane, and delivers it to every local lane', async () => {
    const { posting, network, delivery } = await setup();
    const sent = await posting.personPost({ room: TEST_ROOM, kind: 'ask', text: 'Who has the DTO?' });
    expect(sent).toMatchObject({ ok: true, data: { own: true, from: { user: 'Mitch Healy', person: true }, lane: null } });
    expect(network.sent.at(-1)?.from.person).toBe(true);
    expect(delivery.received).toHaveBeenCalledWith(expect.objectContaining({ text: 'Who has the DTO?' }), undefined);
    expect(await posting.personPost({ room: 'https://devops:8090/tfs/defaultcollection#1', kind: 'ask', text: 'x' })).toMatchObject({ ok: false });
  }, 60_000);
});

describe('describePeers (AL-292)', () => {
  it('lists the room and the files this lane shares with others', () => {
    const member = (overrides: Partial<RoomMember>): RoomMember => ({ instance: ME.instance, user: 'Mitch Healy', host: 'MITCH-PC', lane: testLane(48162), touched: [], lastSeenAt: 0, local: true, reachable: true, ...overrides });
    const text = describePeers(
      'Feature #48000 · Job DTO',
      '48162',
      [
        member({ touched: ['src/JobDto.cs', 'src/Mapper.cs'] }),
        member({ local: false, user: 'Kyle Richards', host: 'KYLE-PC', lane: testLane(48161), touched: ['src/JobDto.cs', 'src/JobService.cs'], lastSeenAt: 0 }),
      ],
      5 * 60_000,
    );
    expect(text.split('\n')).toEqual([
      'Room Feature #48000 · Job DTO',
      '- You: #48162 (implementing) on 48162-story · touched src/JobDto.cs, src/Mapper.cs',
      '- Kyle Richards on KYLE-PC: #48161 (implementing) on 48161-story · touched src/JobDto.cs, src/JobService.cs · last seen 5 min ago',
      'Overlap: src/JobDto.cs (Kyle Richards on KYLE-PC)',
    ]);
  });
});
