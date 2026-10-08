import { join } from 'node:path';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Lane } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createSessionManager } from '../agent/session-manager';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult } from '../agent/testing/fake-claude';
import { SESSION_TEST_BASE, eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from '../agent/testing/sessions';
import { createMemoryRecordFs } from '../tickets/testing';
import type { ArtboardSourceReader } from './artboard-sources';
import { createDesignShipService, shipLine, shipMessage } from './ship';
import { createDesignSpecFiles } from './spec-store';
import { fakeSpec } from './testing/specs';

const CANVAS = { kind: 'design-project' as const, id: 'p-71273', url: 'https://claude.ai/design/p/p-71273' };
const ARTBOARDS = [
  { id: 'JobControl.html', name: 'JobControl · desktop', width: 1440, height: 900 },
  { id: 'JobFilter.html', name: 'JobFilter · side panel', width: 420, height: 900 },
];

function text(message: SDKUserMessage): string {
  return String(message.message.content);
}

/** The agent answers each user turn; a design hand-off gets a reply that names the spec version. */
function agentReply(message: SDKUserMessage): SDKMessage[] {
  const version = /Design (v\d+) approved/.exec(text(message))?.[1];
  return [fakeAssistant(version ? `Reading Design ${version} with get_design_spec and adjusting the grid.` : 'Working on it.'), fakeResult()];
}

async function setup(options: { stage?: Lane; canvas?: boolean; sessionId?: string } = {}) {
  const tickets = await memoryTickets({ id: '71273', stage: options.stage ?? 'implementing' });
  await tickets.update('71273', (record) => ({
    ...record,
    sessionId: options.sessionId ?? null,
    design: { ...record.design, canvas: options.canvas === false ? null : CANVAS },
  }));
  const files = createDesignSpecFiles({ rootDir: join(SESSION_TEST_BASE, 'design-specs'), fs: createMemoryRecordFs() });
  const sources: ArtboardSourceReader = { read: vi.fn(async (_canvas: unknown, ids: readonly string[]) => new Map<string, string | null>(ids.map((id) => [id, `<source of ${id}>`]))) };
  const events = recordingEmit();
  const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')], onSend: agentReply });
  const output: string[] = [];
  const sessions = createSessionManager({
    claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
    connections: fakeClaudeConnections(),
    tickets,
    emit: events.emit,
  });
  sessions.subscribe(({ message }) => {
    if (message.type === 'assistant') output.push(String((message.message.content[0] as { text?: string }).text));
  });
  const appendSystem = vi.fn();
  const ship = createDesignShipService({ tickets, files, sources, sessions, emit: events.emit, transcripts: { appendSystem }, userName: () => 'Kyle', now: () => 14 * 3_600_000 });
  return { tickets, files, sources, events, fake, sessions, appendSystem, ship, output };
}

describe('Approve & ship design (AL-197)', () => {
  it('during Implementing: snapshots v1 with sources, reaches the running agent without a restart, and shows in the Output stream', async () => {
    const { tickets, files, sources, events, fake, sessions, appendSystem, ship, output } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);

    const shipped = await ship.ship({ ticketId: '71273', artboards: ARTBOARDS, note: 'Use the compact grid' });

    expect(shipped).toMatchObject({ ok: true, data: { delivered: true, spec: { version: 1, approvedBy: 'Kyle', artboardCount: 2, usedAt: null } } });
    const record = (await tickets.get('71273'))!;
    expect(record.design.specs).toEqual([
      { version: 1, shippedAt: 14 * 3_600_000, approvedBy: 'Kyle', artboardCount: 2, usedAt: null, fetchedAt: null, deliveredAt: 14 * 3_600_000 },
    ]);
    const stored = await files.read(record.repo, '71273', 1);
    expect(stored).toMatchObject({
      version: 1,
      note: 'Use the compact grid',
      canvasUrl: CANVAS.url,
      tokensFile: 'agent-lanes-tokens.css',
      supersedes: null,
      artboards: [
        { ...ARTBOARDS[0], source: '<source of JobControl.html>' },
        { ...ARTBOARDS[1], source: '<source of JobFilter.html>' },
      ],
    });
    expect(sources.read).toHaveBeenCalledWith(CANVAS, ['JobControl.html', 'JobFilter.html']);

    // Same session, no restart: the hand-off is the next user turn, interjected with priority 'now' (D11).
    await fake.calls[0]!.sentCount(2);
    expect(fake.calls).toHaveLength(1);
    const handOff = fake.calls[0]!.sent[1]!;
    expect(handOff.priority).toBe('now');
    expect(text(handOff)).toContain('Design v1 approved by Kyle · 2 artboards: JobControl · desktop, JobFilter · side panel.');
    expect(text(handOff)).toContain('get_design_spec');
    expect(text(handOff)).toContain('ack_design_spec with version 1');
    await eventually(() => output.some((line) => line.includes('Design v1')));

    expect(appendSystem).toHaveBeenCalledWith('71273', 'Design v1 approved by Kyle · 2 artboards');
    expect(events.of('design:spec')).toEqual([
      { ticketId: '71273', version: 1, change: 'shipped' },
      { ticketId: '71273', version: 1, change: 'delivered' },
    ]);
    await sessions.dispose();
  });

  it('shipping twice creates v1 and v2, and the agent is told v2 supersedes v1', async () => {
    const { tickets, files, fake, sessions, ship } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);

    await ship.ship({ ticketId: '71273', artboards: ARTBOARDS });
    await ship.ship({ ticketId: '71273', artboards: [ARTBOARDS[0]!] });

    const record = (await tickets.get('71273'))!;
    expect(record.design.specs.map((spec) => [spec.version, spec.artboardCount])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    await expect(files.read(record.repo, '71273', 2)).resolves.toMatchObject({ version: 2, supersedes: 1 });
    await fake.calls[0]!.sentCount(3);
    expect(text(fake.calls[0]!.sent[2]!)).toContain('Design v2 supersedes v1: where they differ, follow v2.');
    await sessions.dispose();
  });

  it('two ships at once get different versions', async () => {
    const { tickets, ship } = await setup();
    await Promise.all([ship.ship({ ticketId: '71273', artboards: ARTBOARDS }), ship.ship({ ticketId: '71273', artboards: ARTBOARDS })]);
    expect((await tickets.get('71273'))?.design.specs.map((spec) => spec.version)).toEqual([1, 2]);
  });

  it('during Planning the hand-off asks the agent to fold the spec into the plan it asks the user to approve', async () => {
    const { fake, sessions, ship } = await setup({ stage: 'planning' });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    await expect(ship.ship({ ticketId: '71273', artboards: ARTBOARDS })).resolves.toMatchObject({ ok: true, data: { delivered: true } });
    await fake.calls[0]!.sentCount(2);
    expect(text(fake.calls[0]!.sent[1]!)).toContain('Planning: the plan you ask the user to approve');
    await sessions.dispose();
  });

  it('holds the spec while no session runs and delivers it first when the session resumes', async () => {
    const { tickets, events, fake, sessions, ship } = await setup({ sessionId: 'session-a' });

    await expect(ship.ship({ ticketId: '71273', artboards: ARTBOARDS })).resolves.toMatchObject({ ok: true, data: { delivered: false, spec: { deliveredAt: null } } });
    expect(events.of('design:spec').map((event) => event['change'])).toEqual(['shipped']);

    // Resuming sends no first turn: the held spec is the first thing the session gets.
    await sessions.start({ ticketId: '71273' });
    await fake.calls[0]!.sentCount(1);
    expect(fake.calls[0]!.sent[0]!.priority).toBe('now');
    expect(text(fake.calls[0]!.sent[0]!)).toContain('Design v1 approved by Kyle');
    await eventually(() => events.of('design:spec').some((event) => event['change'] === 'delivered'));
    expect((await tickets.get('71273'))?.design.specs[0]?.deliveredAt).toBe(14 * 3_600_000);
    await sessions.dispose();
  });

  it('while paused, the session holds the spec and delivers it on Resume', async () => {
    const { fake, sessions, ship } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    await sessions.pause('71273');

    await expect(ship.ship({ ticketId: '71273', artboards: ARTBOARDS })).resolves.toMatchObject({ ok: true, data: { delivered: true } });
    expect(fake.calls[0]!.sent).toHaveLength(1);

    sessions.resume('71273');
    await fake.calls[0]!.sentCount(2);
    expect(text(fake.calls[0]!.sent[1]!)).toContain('Design v1 approved by Kyle');
    await sessions.dispose();
  });

  it('ships without sources when no canvas is linked', async () => {
    const { tickets, files, sources, ship } = await setup({ canvas: false });
    await ship.ship({ ticketId: '71273', artboards: ARTBOARDS });
    expect(sources.read).not.toHaveBeenCalled();
    const record = (await tickets.get('71273'))!;
    await expect(files.read(record.repo, '71273', 1)).resolves.toMatchObject({ canvasUrl: null, artboards: [{ source: null }, { source: null }] });
  });

  it('words the Output line and the hand-off message', () => {
    expect(shipLine(fakeSpec(2))).toBe('Design v2 approved by Kyle · 2 artboards');
    expect(shipLine({ ...fakeSpec(1), artboards: [fakeSpec(1).artboards[0]!] })).toBe('Design v1 approved by Kyle · 1 artboard');
    const message = shipMessage(fakeSpec(2));
    expect(message).toContain('Note from Kyle: Tighter filter panel');
    expect(message).toContain('Code review or QA: check the work against it');
  });
});
