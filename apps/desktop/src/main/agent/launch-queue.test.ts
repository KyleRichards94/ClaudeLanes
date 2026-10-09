import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from './claude-sdk';
import { QUEUED_MESSAGE, createLaunchQueue, type LaunchQueue } from './launch-queue';
import { createSessionRecovery } from './recovery';
import { createSessionManager, type SessionManager } from './session-manager';
import { createFakeClaude, fakeInit } from './testing/fake-claude';
import { SESSION_TEST_BASE, eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

const REPO_A = join(SESSION_TEST_BASE, 'repo-a');
const REPO_B = join(SESSION_TEST_BASE, 'repo-b');

const LIVE = new Set(['starting', 'running', 'idle', 'paused']);

async function setup(options: { cap?: number; tickets?: Array<{ id: string; repo: string }> } = {}) {
  let cap = options.cap ?? 2;
  let started = 0;
  const fake = createFakeClaude(() => ({ live: true, messages: [fakeInit(`session-${++started}`)] }));
  const list = options.tickets ?? ['1', '2', '3', '4'].map((id) => ({ id, repo: REPO_A }));
  const tickets = await memoryTickets(...list);
  const events = recordingEmit();
  const ended: { launches?: LaunchQueue } = {};
  const sessions: SessionManager = createSessionManager({
    claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
    connections: fakeClaudeConnections(),
    tickets,
    emit: events.emit,
    onEnded: () => void ended.launches?.refresh(),
    watchdogMs: 0,
  });
  const launches = createLaunchQueue({ sessions, tickets, maxAgents: () => cap, emit: events.emit });
  ended.launches = launches;
  /** Live sessions per repo, as the session manager reports them. */
  const liveIn = async (repo: string) => {
    let count = 0;
    for (const status of sessions.list()) if (LIVE.has(status.state) && (await tickets.get(status.ticketId))?.repo === repo) count += 1;
    return count;
  };
  return { fake, tickets, events, sessions, launches, liveIn, setCap: (value: number) => (cap = value) };
}

const launch = (launches: LaunchQueue, ticketId: string) => launches.launch({ ticketId, jobDescription: `Job ${ticketId}` });

describe('concurrency cap and Queued lane (AL-111)', () => {
  it('never runs more sessions per repo than the cap; extra launches wait with "Waiting for a free slot"', async () => {
    const { sessions, launches, events, liveIn } = await setup({ cap: 2 });
    const results = await Promise.all(['1', '2', '3', '4'].map((id) => launch(launches, id)));

    expect(results.map((result) => result.ok && result.data.state)).toEqual(['running', 'running', 'queued', 'queued']);
    expect(await liveIn(REPO_A)).toBe(2);
    expect(launches.queued(REPO_A)).toEqual(['3', '4']);
    expect(launches.status('3')).toEqual({ ticketId: '3', state: 'queued', sessionId: null, message: QUEUED_MESSAGE });
    expect(events.of('agent:status', '3')).toEqual([expect.objectContaining({ state: 'queued', message: QUEUED_MESSAGE })]);
    await sessions.dispose();
  });

  it('starts queued launches first in, first out as slots free, and never exceeds the cap', async () => {
    const { sessions, launches, liveIn } = await setup({ cap: 2 });
    for (const id of ['1', '2', '3', '4']) await launch(launches, id);

    await sessions.stop('1');
    await eventually(() => sessions.status('3').state === 'running');
    expect(sessions.status('4').state).toBe('none');
    expect(launches.queued(REPO_A)).toEqual(['4']);
    expect(await liveIn(REPO_A)).toBe(2);

    await sessions.stop('2');
    await eventually(() => sessions.status('4').state === 'running');
    expect(launches.queued(REPO_A)).toEqual([]);
    expect(await liveIn(REPO_A)).toBe(2);
    await sessions.dispose();
  });

  it('frees a slot when a session is lost', async () => {
    const { fake, sessions, launches } = await setup({ cap: 1 });
    await launch(launches, '1');
    await launch(launches, '2');
    expect(launches.status('2').state).toBe('queued');

    fake.calls[0]!.fail(new Error('Claude Code process exited with code 1'));
    await eventually(() => sessions.status('2').state === 'running');
    expect(sessions.status('1').state).toBe('lost');
    await sessions.dispose();
  });

  it('counts each repo on its own', async () => {
    const { sessions, launches } = await setup({
      cap: 1,
      tickets: [
        { id: '1', repo: REPO_A },
        { id: '2', repo: REPO_A },
        { id: '3', repo: REPO_B },
      ],
    });
    for (const id of ['1', '2', '3']) await launch(launches, id);
    expect(launches.status('2').state).toBe('queued');
    expect(sessions.status('3').state).toBe('running');
    await sessions.dispose();
  });

  it('"Start now" starts a queued ticket at once, over the cap, and the rest keep their order', async () => {
    const { sessions, launches, liveIn } = await setup({ cap: 1 });
    for (const id of ['1', '2', '3']) await launch(launches, id);

    const started = await launches.startNow('3');
    expect(started.ok && started.data.state).toBe('running');
    expect(await liveIn(REPO_A)).toBe(2);
    expect(launches.queued(REPO_A)).toEqual(['2']);

    // With two live over a cap of one, one ending does not start the next.
    await sessions.stop('1');
    await launches.refresh();
    expect(launches.status('2').state).toBe('queued');
    await sessions.stop('3');
    await eventually(() => sessions.status('2').state === 'running');
    await sessions.dispose();
  });

  it('starts waiting launches when the cap is raised', async () => {
    const { sessions, launches, setCap } = await setup({ cap: 1 });
    for (const id of ['1', '2', '3']) await launch(launches, id);
    setCap(3);
    await launches.refresh();
    expect(['1', '2', '3'].map((id) => sessions.status(id).state)).toEqual(['running', 'running', 'running']);
    await sessions.dispose();
  });

  it('cancel takes a ticket out of the queue', async () => {
    const { sessions, launches } = await setup({ cap: 1 });
    for (const id of ['1', '2']) await launch(launches, id);
    expect(launches.cancel('2')).toBe(true);
    expect(launches.status('2').state).toBe('none');
    await sessions.stop('1');
    await launches.refresh();
    expect(sessions.status('2').state).toBe('none');
    await sessions.dispose();
  });

  it('a lost session restarted by crash recovery goes ahead of queued launches when the repo is full', async () => {
    const { fake, sessions, launches, events } = await setup({ cap: 1 });
    const recovery = createSessionRecovery({ sessions, restart: (ticketId, onStarted) => launches.restart(ticketId, onStarted), emit: events.emit });
    await launch(launches, '1');
    await eventually(() => sessions.status('1').sessionId !== null);
    await launch(launches, '2');
    // Ticket 2 takes the slot while 1 is lost and waiting on the user's Reconnect.
    fake.calls[0]!.fail(new Error('exited'));
    await eventually(() => sessions.status('2').state === 'running');
    await launch(launches, '3');

    const reconnected = await recovery.reconnect('1');
    expect(reconnected.ok && reconnected.data.state).toBe('queued');
    expect(launches.queued(REPO_A)).toEqual(['1', '3']);
    await sessions.stop('2');
    await eventually(() => sessions.status('1').state === 'idle' || sessions.status('1').state === 'running');
    expect(launches.queued(REPO_A)).toEqual(['3']);
    await sessions.dispose();
  });
});

describe('plan-limit hold (AL-258)', () => {
  it('queues new launches with the hold reason, lifts the hold on refresh, and lets Start now through', async () => {
    let hold: string | null = 'Waiting for plan limit · 5-hour window at 87%';
    const fake = createFakeClaude(() => ({ live: true, messages: [fakeInit('session-h')] }));
    const tickets = await memoryTickets({ id: '1', repo: join(SESSION_TEST_BASE, 'a') }, { id: '2', repo: join(SESSION_TEST_BASE, 'a') });
    const events = recordingEmit();
    const sessions = createSessionManager({
      claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
      connections: fakeClaudeConnections(),
      tickets,
      emit: events.emit,
    });
    const launches = createLaunchQueue({ sessions, tickets, maxAgents: () => 3, hold: () => hold, emit: events.emit });

    const queued = await launches.launch({ ticketId: '1', jobDescription: 'go' });
    expect(queued).toMatchObject({ ok: true, data: { state: 'queued', message: 'Waiting for plan limit · 5-hour window at 87%' } });
    expect(launches.queued(join(SESSION_TEST_BASE, 'a'))).toEqual(['1']);

    // Start now ignores the hold.
    await launches.launch({ ticketId: '2', jobDescription: 'go' });
    expect(launches.queued(join(SESSION_TEST_BASE, 'a'))).toEqual(['1', '2']);
    await launches.startNow('2');
    await eventually(() => sessions.status('2').state === 'running');

    hold = null;
    await launches.refresh();
    await eventually(() => sessions.status('1').state === 'running');
    expect(launches.queued(join(SESSION_TEST_BASE, 'a'))).toEqual([]);
    await sessions.dispose();
  });
});
