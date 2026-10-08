import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_TEST_BASE, memoryTickets, recordingEmit } from '../agent/testing/sessions';
import { createMemoryRecordFs } from '../tickets/testing';
import { createDesignSpecFiles, designSpecPath } from './spec-store';
import { fakeSpec } from './testing/specs';
import { NO_DESIGN_SPEC_MESSAGE, createDesignSpecService, specForAgent, specStatusText } from './specs';

const ROOT = join(SESSION_TEST_BASE, 'user-data', 'design-specs');

/** Ticket 71273 with `versions` shipped specs on disk and on its record. */
async function setup(versions = 2) {
  const tickets = await memoryTickets({ id: '71273', stage: 'implementing' });
  const fs = createMemoryRecordFs();
  const files = createDesignSpecFiles({ rootDir: ROOT, fs });
  const record = (await tickets.get('71273'))!;
  for (let version = 1; version <= versions; version++) await files.write(record.repo, fakeSpec(version));
  await tickets.update('71273', (current) => ({
    ...current,
    design: {
      ...current.design,
      specs: Array.from({ length: versions }, (_, index) => ({
        version: index + 1,
        shippedAt: 1_000 + index,
        approvedBy: 'Kyle',
        artboardCount: 2,
        usedAt: null,
        fetchedAt: null,
      })),
    },
  }));
  const events = recordingEmit();
  const appendSystem = vi.fn();
  let clock = 50_000;
  const specs = createDesignSpecService({ tickets, files, emit: events.emit, transcripts: { appendSystem }, now: () => clock });
  return { tickets, fs, files, record, events, appendSystem, specs, tick: (ms: number) => (clock += ms) };
}

describe('design spec files (AL-197, D8)', () => {
  it('keeps each version as JSON in the app data folder, outside the worktree, and reads it back', async () => {
    const { files, record } = await setup(1);
    const path = designSpecPath(ROOT, record.repo, '71273', 1);
    expect(path.startsWith(ROOT)).toBe(true);
    expect(path.endsWith(join('71273', 'v1.json'))).toBe(true);
    expect(path.startsWith(record.worktreePath)).toBe(false);
    await expect(files.read(record.repo, '71273', 1)).resolves.toEqual(fakeSpec(1));
    await expect(files.read(record.repo, '71273', 9)).resolves.toBeUndefined();
  });

  it('ignores a file that is not a valid spec', async () => {
    const { fs, record } = await setup(0);
    const warn = vi.fn();
    const files = createDesignSpecFiles({ rootDir: ROOT, fs, warn });
    await fs.mkdir(dirname(designSpecPath(ROOT, record.repo, '71273', 1)));
    await fs.writeFileSynced(designSpecPath(ROOT, record.repo, '71273', 1), '{"version":1}');
    await expect(files.read(record.repo, '71273', 1)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('design specs for the agent (AL-198)', () => {
  it('get returns the latest spec by default and marks it fetched once ("Agent is watching this canvas")', async () => {
    const { tickets, events, specs } = await setup(2);
    const latest = await specs.get('71273', undefined, { fetchedByAgent: true });
    expect(latest).toEqual({ ok: true, data: fakeSpec(2) });
    expect((await tickets.get('71273'))?.design.specs.map((spec) => spec.fetchedAt)).toEqual([null, 50_000]);
    expect(events.of('design:spec')).toEqual([{ ticketId: '71273', version: 2, change: 'fetched' }]);

    // Again, or an older version, or the design tab reading it: nothing new.
    await specs.get('71273', undefined, { fetchedByAgent: true });
    await specs.get('71273', 1, { fetchedByAgent: true });
    await specs.get('71273', 2);
    expect(events.of('design:spec')).toHaveLength(1);
  });

  it('says when there is no spec, or no such version', async () => {
    const none = await setup(0);
    await expect(none.specs.get('71273')).resolves.toMatchObject({ ok: false, message: NO_DESIGN_SPEC_MESSAGE });
    const two = await setup(2);
    await expect(two.specs.get('71273', 5)).resolves.toMatchObject({ ok: false, message: 'There is no Design v5; the latest is v2.' });
    await expect(two.specs.ack('71273', 5, '')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('ack marks the spec Used with the time, tells the renderer and adds a line to the output', async () => {
    const { tickets, events, appendSystem, specs, tick } = await setup(2);
    await specs.get('71273', undefined, { fetchedByAgent: true });
    tick(60_000);
    const acked = await specs.ack('71273', 2, 'Built JobGrid.razor from\n JobControl · desktop');
    expect(acked).toMatchObject({ ok: true, data: { version: 2, usedAt: 110_000, fetchedAt: 50_000 } });
    expect((await tickets.get('71273'))?.design.specs.at(-1)?.usedAt).toBe(110_000);
    expect(events.of('design:spec').at(-1)).toEqual({ ticketId: '71273', version: 2, change: 'used' });
    expect(appendSystem).toHaveBeenCalledWith('71273', 'Design v2 used by the agent · Built JobGrid.razor from JobControl · desktop');

    // A second ack changes nothing.
    tick(1_000);
    await expect(specs.ack('71273', 2, 'again')).resolves.toMatchObject({ ok: true, data: { usedAt: 110_000 } });
    expect(events.of('design:spec', '71273').filter((event) => event['change'] === 'used')).toHaveLength(1);
  });

  it('lists the record specs and words their status for the agent', async () => {
    const { specs } = await setup(2);
    const listed = await specs.list('71273');
    expect(listed.ok && listed.data.map((spec) => spec.version)).toEqual([1, 2]);
    if (!listed.ok) return;
    expect(specStatusText(listed.data[0]!, 2)).toBe('superseded by v2');
    expect(specStatusText(listed.data[1]!, 2)).toBe('sent, not yet acknowledged');
  });

  it('tells the agent which version supersedes which and how to acknowledge it', () => {
    const text = specForAgent(fakeSpec(2));
    expect(text).toContain('Design v2, approved by Kyle');
    expect(text).toContain('It supersedes v1: where they differ, follow v2.');
    expect(text).toContain("The user's note: Tighter filter panel");
    expect(text).toContain('agent-lanes-tokens.css');
    expect(text).toContain('call ack_design_spec with version 2');
    expect(text).toContain('"source": "<main>grid</main>"');
  });
});
