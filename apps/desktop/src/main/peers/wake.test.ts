import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ok, type PeerFrame, type PeerKind, type UnsignedPeerFrame } from '@agent-lanes/contracts';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createLaunchQueue } from '../agent/launch-queue';
import { createSessionRecovery } from '../agent/recovery';
import { LIVE_SESSION_STATES, createSendToTicket } from '../agent/send-to-ticket';
import { createSessionManager } from '../agent/session-manager';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult } from '../agent/testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from '../agent/testing/sessions';
import { createDelivery, type DeliveryLane } from './delivery';
import type { PeerNetwork } from './network';
import type { LocalLane, Rooms } from './rooms';
import { createPeerLanes } from './service';
import { signFrame } from './signer';
import { TEST_ROOM, TEST_TEAM, testLane } from './testing';

/** AL-299: a room message wakes an idle agent, and starts a session for a lane with none. */

const KYLE = { user: 'Kyle Richards', host: 'KYLE-PC', instance: randomUUID(), person: false };
const ASK_LINE = `[Peer lanes] Kyle Richards's agent on #48161 (Implementing) · ask: "Who has the mapper?"`;

function frame(kind: PeerKind, text: string, overrides: Partial<UnsignedPeerFrame> = {}): PeerFrame {
  return signFrame({ v: 1, id: randomUUID(), room: TEST_ROOM, team: TEST_TEAM.tag, kind, from: KYLE, lane: testLane(48161), text, data: {}, sentAt: new Date().toISOString(), replay: false, ...overrides }, TEST_TEAM.key);
}

/** The app's own wiring for a room turn: the composer's path (AL-268) over the fake SDK. */
async function app(...ticketIds: string[]) {
  const fake = createFakeClaude((call) => ({ live: true, messages: [fakeInit(`session-${(call.options.cwd ?? '').slice(-5)}`)], onSend: (message) => (message.shouldQuery === false ? [] : [fakeAssistant('Noted'), fakeResult()]) }));
  const tickets = await memoryTickets(...ticketIds.map((id) => ({ id })));
  const events = recordingEmit();
  const sessions = createSessionManager({ claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }), connections: fakeClaudeConnections(), tickets, emit: events.emit, watchdogMs: 0 });
  const launches = createLaunchQueue({ sessions, tickets, maxAgents: () => 5, emit: recordingEmit().emit });
  const recovery = createSessionRecovery({ sessions, restart: (ticketId, onStarted) => launches.restart(ticketId, onStarted), emit: recordingEmit().emit });
  const sendToTicket = createSendToTicket({ sessions, launches, recovery, tickets });
  const delivery = createDelivery({
    lanesIn: () => ticketIds.map((ticketId): DeliveryLane => ({ ticketId, workItemId: Number(ticketId), live: LIVE_SESSION_STATES.has(sessions.status(ticketId).state), receives: true })),
    me: () => 'Mitch Healy',
    send: (ticketId, text) => void sendToTicket(ticketId, { text, source: 'app' }),
    readLog: async () => ({ messages: [], capped: false }),
    roomTitle: () => 'Feature #48000',
    coalesceMs: 30,
  });
  const callFor = (ticketId: string) => fake.calls.filter((call) => (call.options.cwd ?? '').endsWith(ticketId));
  const said = (ticketId: string) => callFor(ticketId).flatMap((call) => call.sent.map((sent) => sent.message.content as string));
  return { fake, sessions, delivery, events, callFor, said };
}

describe('waking agents on a room message (AL-299)', () => {
  it('gives an idle agent an ask as a turn, and it runs', async () => {
    const { sessions, delivery, events, said } = await app('48162');
    await sessions.start({ ticketId: '48162', jobDescription: 'Work the story' });
    await eventually(() => sessions.status('48162').state === 'idle');
    const before = events.of('agent:status', '48162').length;

    const sentAt = Date.now();
    delivery.received(frame('ask', 'Who has the mapper?'));
    await vi.waitFor(() => expect(said('48162')).toContain(ASK_LINE), { timeout: 2_000 });
    expect(Date.now() - sentAt).toBeLessThan(2_000);
    await eventually(() => events.of('agent:status', '48162').slice(before).some((event) => event['state'] === 'running'));
    await eventually(() => sessions.status('48162').state === 'idle');
    delivery.dispose();
    await sessions.dispose();
  });

  it("starts a session for a lane that never had one, and resumes a stopped one, each with the peer message as its first turn", async () => {
    const { fake, sessions, delivery, callFor } = await app('48170', '48180');
    await sessions.start({ ticketId: '48180', jobDescription: 'Work the story' });
    await eventually(() => sessions.status('48180').state === 'idle' && sessions.status('48180').sessionId !== null);
    await sessions.stop('48180');
    expect(sessions.status('48180').state).toBe('stopped');
    expect(sessions.status('48170').state).toBe('none');

    delivery.received(frame('ask', 'Who has the mapper?'));
    await vi.waitFor(() => {
      expect(callFor('48170')).toHaveLength(1);
      expect(callFor('48180')).toHaveLength(2);
    });
    const [fresh] = callFor('48170');
    await fresh!.sentCount(1);
    expect(fresh!.sent[0]!.message.content as string).toContain(ASK_LINE);
    const resumed = callFor('48180')[1]!;
    expect(resumed.options.resume).toBe('session-48180');
    await resumed.sentCount(1);
    expect(resumed.sent[0]!.message.content as string).toBe(ASK_LINE);
    expect(fake.calls).toHaveLength(3);
    delivery.dispose();
    await sessions.dispose();
  });

  it('wakes nothing for status, touched or bye, idle or stopped', async () => {
    const { fake, sessions, delivery, said } = await app('48162', '48170');
    await sessions.start({ ticketId: '48162', jobDescription: 'Work the story' });
    await eventually(() => sessions.status('48162').state === 'idle');
    const calls = fake.calls.length;
    const sent = said('48162').length;

    delivery.received(frame('status', ''));
    delivery.received(frame('touched', '', { data: { files: ['src/JobDto.cs'] } }));
    delivery.received(frame('bye', ''));
    await new Promise((done) => setTimeout(done, 150));
    expect(fake.calls).toHaveLength(calls);
    expect(said('48162')).toHaveLength(sent);
    expect(sessions.status('48170').state).toBe('none');
    delivery.dispose();
    await sessions.dispose();
  });
});

describe('peer lanes hands room turns to the wake path (AL-299)', () => {
  it('sends an ask for a stopped lane through wake, and never a status or touched', async () => {
    let onFrame: (frame: PeerFrame) => void = () => undefined;
    const wake = vi.fn(async () => ok({ held: false }));
    const lane = { record: { id: '48162', stage: 'implementing', ado: { orgUrl: 'https://devops:8090/tfs/DefaultCollection', project: 'OnSite Companion', workItemId: 48162 } }, room: { id: TEST_ROOM }, touched: [] } as unknown as LocalLane;
    const peerLanes = createPeerLanes({
      network: {
        onFrame: (listener) => ((onFrame = listener), () => undefined),
        onPeer: () => () => undefined,
        broadcast: () => null,
        status: () => ({}) as ReturnType<PeerNetwork['status']>,
        identity: () => ({ user: 'Mitch Healy', host: 'MITCH-PC', instance: randomUUID() }),
      },
      rooms: { localIn: () => [lane], members: () => [], onPresence: () => () => undefined, view: () => ({ rooms: [], others: [] }), roomFor: async () => null, ensureRoom: async () => null } as Pick<Rooms, 'localIn' | 'members' | 'onPresence' | 'view' | 'roomFor' | 'ensureRoom'>,
      roomLog: { recordReceived: () => true, read: async () => ({ room: TEST_ROOM, messages: [], capped: false }), replayTo: async () => undefined, flush: async () => undefined } as never,
      tickets: { get: async () => undefined },
      git: { status: async () => ok({}) } as never,
      sessions: { status: (ticketId) => ({ ticketId, state: 'stopped', sessionId: 'session-48162', message: null }) },
      wake,
    });
    onFrame(frame('status', ''));
    onFrame(frame('touched', '', { data: { files: ['src/JobDto.cs'] } }));
    await new Promise((done) => setTimeout(done, 2_200));
    expect(wake).not.toHaveBeenCalled();
    onFrame(frame('ask', 'Who has the mapper?'));
    await vi.waitFor(() => expect(wake).toHaveBeenCalledWith('48162', { text: ASK_LINE, source: 'app' }), { timeout: 4_000 });
    await peerLanes.dispose();
  }, 10_000);
});
