import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TICKET_RECORD_LIMITS, TicketRecordSchema, type TicketRecord } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeRecordFs, type RecordFs } from './atomic-file';
import { recordFilePath, repoKey } from './paths';
import { stageEnteredAt } from './record';
import { createTicketRecordStore, type TicketRecordStoreOptions } from './record-store';
import { createCrashingFs, createMemoryRecordFs, createTempDir, listTree, newTicketInput, type CrashPoint, type MemoryRecordFs } from './testing';

const START = 1_760_000_000_000;

let dir: string;
let remove: () => Promise<void>;
let root: string;
let clock: number;
let warn: ReturnType<typeof vi.fn<(message: string) => void>>;

beforeEach(async () => {
  ({ dir, remove } = await createTempDir());
  root = join(dir, 'userData', 'tickets');
  clock = START;
  warn = vi.fn<(message: string) => void>();
});

afterEach(async () => {
  vi.useRealTimers();
  await remove();
});

function open(options: Partial<TicketRecordStoreOptions> = {}) {
  return createTicketRecordStore({ rootDir: root, now: () => clock, warn, debounceMs: 50, maxWaitMs: 120, retryMs: 60_000, ...options });
}

function input(overrides: Parameters<typeof newTicketInput>[1] = {}) {
  return newTicketInput(dir, overrides);
}

function fileOf(id = '71273', repo = input().repo): string {
  return recordFilePath(root, repo, id);
}

async function readRecordFile(id = '71273', repo?: string): Promise<TicketRecord> {
  return TicketRecordSchema.parse(JSON.parse(await readFile(fileOf(id, repo), 'utf8')));
}

async function created(store: ReturnType<typeof open>, overrides: Parameters<typeof newTicketInput>[1] = {}): Promise<TicketRecord> {
  const result = await store.create(input(overrides));
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

describe('create and read back', () => {
  it('writes the record before create resolves and reads it back after a restart', async () => {
    const store = open();
    const record = await created(store);

    expect(await readRecordFile()).toEqual(record);
    expect(await listTree(root)).toEqual([`${repoKey(input().repo)}/`, `${repoKey(input().repo)}/71273.json`]);

    const restarted = open();
    expect(await restarted.get('71273')).toEqual(record);
    expect(await restarted.list()).toEqual([record]);
    expect(await restarted.issues()).toEqual([]);
  });

  it('starts a ticket in Queued with no session, sub-branches, builds or design', async () => {
    const record = await created(open());
    expect(record).toMatchObject({
      version: 1,
      id: '71273',
      stage: 'queued',
      stageHistory: [{ stage: 'queued', at: START }],
      subBranches: [],
      sessionId: null,
      lastBuild: null,
      lastRun: null,
      design: { canvas: null, lastViewUrl: null, specs: [] },
      createdAt: START,
      updatedAt: START,
    });
  });

  it('starts nothing on disk for an empty profile', async () => {
    const store = open();
    expect(await store.list()).toEqual([]);
    expect(await store.issues()).toEqual([]);
    expect(await listTree(dir)).toEqual([]);
  });

  it('refuses an id that is already taken, in the same repo or another one', async () => {
    const store = open();
    await created(store);

    expect(await store.create(input())).toMatchObject({ ok: false, code: 'VALIDATION' });
    const other = await store.create(input({ repo: join(dir, 'other-repo') }));
    expect(other).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await store.list()).toHaveLength(1);
  });

  it('refuses two launches of one id at the same time', async () => {
    const store = open();
    const results = await Promise.all([store.create(input()), store.create(input())]);
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
  });

  it('refuses an invalid record and writes nothing', async () => {
    const store = open();
    expect(await store.create(input({ id: 'AL-2' }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await store.create(input({ id: '..' }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await store.create(input({ skills: ['a', 'a'] }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await listTree(dir)).toEqual([]);
  });

  it('refuses relative repo and worktree paths', async () => {
    const store = open();
    expect(await store.create(input({ repo: 'onsite-companion' }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await store.create(input({ worktreePath: join('..', '.agent-lanes', '71273') }))).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await listTree(dir)).toEqual([]);
  });

  it('lists records oldest first, and per repo', async () => {
    const store = open();
    const first = await created(store, { id: '71273' });
    clock += 1;
    const second = await created(store, { id: 'nt-20261007-fix-login', ado: null, repo: join(dir, 'other-repo') });
    clock += 1;
    const third = await created(store, { id: '71100' });

    expect((await store.list()).map((record) => record.id)).toEqual([first.id, second.id, third.id]);
    expect(await store.list({ repo: input().repo })).toEqual([first, third]);
    expect(await store.list({ repo: `${input().repo}/` })).toEqual([first, third]);
    expect(await store.list({ repo: join(dir, 'other-repo') })).toEqual([second]);
  });

  it.runIf(process.platform === 'win32')('matches a repo however Windows spells its path', async () => {
    const store = open();
    const record = await created(store);
    expect(await store.list({ repo: record.repo.toUpperCase() })).toEqual([record]);
  });

  it('hands out copies, so changing one does not change the store', async () => {
    const store = open();
    const record = await created(store);
    record.skills.push('changed');
    const fetched = await store.get('71273');
    if (fetched) fetched.title = 'changed';
    expect(await store.get('71273')).toMatchObject({ skills: ['code-review'], title: 'Cutover frmJobControl to Blazor' });
  });
});

describe('update', () => {
  it('stamps updatedAt and the time of each stage change', async () => {
    const store = open();
    await created(store);

    clock = START + 1_000;
    await store.update('71273', (record) => ({ ...record, stage: 'planning', sessionId: 'cc-71273' }));
    clock = START + 2_000;
    await store.update('71273', (record) => ({ ...record, model: 'sonnet', effort: 'high' }));
    clock = START + 3_000;
    const result = await store.update('71273', (record) => ({ ...record, stage: 'implementing' }));

    expect(result.ok).toBe(true);
    const record = await store.get('71273');
    expect(record).toMatchObject({ stage: 'implementing', model: 'sonnet', effort: 'high', sessionId: 'cc-71273', updatedAt: START + 3_000 });
    expect(record?.stageHistory).toEqual([
      { stage: 'queued', at: START },
      { stage: 'planning', at: START + 1_000 },
      { stage: 'implementing', at: START + 3_000 },
    ]);
    if (record) expect(stageEnteredAt(record, 'planning')).toBe(START + 1_000);
  });

  it('keeps the latest stage history entries past the cap', async () => {
    const store = open();
    await created(store);
    for (let i = 0; i < TICKET_RECORD_LIMITS.stageHistory + 10; i += 1) {
      clock += 1;
      const result = await store.update('71273', (record) => ({ ...record, stage: record.stage === 'implementing' ? 'code-review' : 'implementing' }));
      expect(result.ok).toBe(true);
    }
    const record = await store.get('71273');
    expect(record?.stageHistory).toHaveLength(TICKET_RECORD_LIMITS.stageHistory);
    expect(record?.stageHistory.at(-1)).toEqual({ stage: record?.stage, at: clock });
  });

  it('refuses to change the id, repo, version or creation time', async () => {
    const store = open();
    const record = await created(store);
    for (const change of [{ id: '71274' }, { repo: join(dir, 'elsewhere') }, { createdAt: 1 }, { version: 2 }] as const) {
      const result = await store.update('71273', (current) => ({ ...current, ...change }) as TicketRecord);
      expect(result, JSON.stringify(change)).toMatchObject({ ok: false, code: 'VALIDATION' });
    }
    expect(await store.get('71273')).toEqual(record);
  });

  it('refuses an invalid change and keeps the record as it was', async () => {
    const store = open();
    const record = await created(store);
    const result = await store.update('71273', (current) => ({ ...current, effort: 'huge' }) as unknown as TicketRecord);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await store.get('71273')).toEqual(record);
  });

  it('reports an unknown ticket and a change function that throws', async () => {
    const store = open();
    await created(store);
    expect(await store.update('71274', (record) => record)).toMatchObject({ ok: false, code: 'VALIDATION' });
    const thrown = await store.update('71273', () => {
      throw new Error('boom');
    });
    expect(thrown).toMatchObject({ ok: false, code: 'INTERNAL', message: expect.stringContaining('boom') });
  });

  it('records sub-branches, builds, runs and design specs', async () => {
    const store = open();
    await created(store);
    const result = await store.update('71273', (record) => ({
      ...record,
      subBranches: [{ name: 'grid', branch: 'sub/71273-grid', worktreePath: join(dir, '.agent-lanes', '71273--grid'), createdAt: START, mergedAt: null }],
      lastBuild: { outcome: 'failed', startedAt: START, finishedAt: START + 5, errors: 3, warnings: 0 },
      lastRun: { startedAt: START, stoppedAt: START + 9, exitCode: 0, url: 'http://localhost:5080' },
      design: {
        canvas: { kind: 'design-project', id: 'abc123', url: 'https://claude.ai/design/p/abc123' },
        lastViewUrl: 'https://claude.ai/design/p/abc123#artboard-2',
        specs: [{ version: 1, shippedAt: START, approvedBy: 'Kyle', artboardCount: 2, usedAt: null }],
      },
    }));
    expect(result.ok).toBe(true);
    await store.flush();
    expect(await readRecordFile()).toEqual(result.ok ? result.data : undefined);
  });
});

describe('debounced writes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  /** The record as the memory file system holds it. */
  function stored(fs: MemoryRecordFs, id = '71273'): TicketRecord {
    const contents = fs.files.get(fileOf(id));
    if (contents === undefined) throw new Error(`no record file for ${id}`);
    return TicketRecordSchema.parse(JSON.parse(contents));
  }

  it('writes once after the quiet period, however many changes came before it', async () => {
    const fs = createMemoryRecordFs();
    const store = open({ fs });
    await created(store);
    expect(fs.recordWrites).toHaveLength(1);

    for (const stage of ['planning', 'implementing', 'code-review', 'qa', 'create-pr'] as const) {
      await store.update('71273', (record) => ({ ...record, stage }));
    }
    await vi.advanceTimersByTimeAsync(49);
    expect(fs.recordWrites).toHaveLength(1);
    expect(stored(fs).stage).toBe('queued');

    await vi.advanceTimersByTimeAsync(1);
    expect(fs.recordWrites).toHaveLength(2);
    expect(stored(fs).stage).toBe('create-pr');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fs.recordWrites).toHaveLength(2);
  });

  it('still writes every maxWaitMs while changes keep coming', async () => {
    const fs = createMemoryRecordFs();
    const store = open({ fs });
    await created(store);

    // A change every 10 ms for 300 ms: the 50 ms quiet period never comes, the 120 ms cap does (at 120 and 240 ms).
    for (let t = 0; t < 300; t += 10) {
      await store.update('71273', (record) => ({ ...record, title: `step ${t}` }));
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(fs.recordWrites).toHaveLength(3);
    expect(stored(fs).title).toBe('step 230');

    await vi.advanceTimersByTimeAsync(50);
    expect(fs.recordWrites).toHaveLength(4);
    expect(stored(fs).title).toBe('step 290');
  });

  it('flush writes unsaved changes at once', async () => {
    const store = open();
    await created(store);
    await store.update('71273', (record) => ({ ...record, sessionId: 'cc-71273' }));

    expect(await store.flush('71273')).toEqual({ ok: true, data: undefined });
    expect((await readRecordFile()).sessionId).toBe('cc-71273');
  });

  it('keeps changes for different tickets apart', async () => {
    const store = open();
    await created(store, { id: '71273' });
    await created(store, { id: '71274' });
    await store.update('71273', (record) => ({ ...record, stage: 'planning' }));
    await store.update('71274', (record) => ({ ...record, stage: 'qa' }));
    await store.flush('71273');

    expect((await readRecordFile('71273')).stage).toBe('planning');
    expect((await readRecordFile('71274')).stage).toBe('queued');
    await store.flush();
    expect((await readRecordFile('71274')).stage).toBe('qa');
  });
});

describe('dispose', () => {
  it('saves every unsaved change on quit, and writes later changes straight away', async () => {
    const store = open({ debounceMs: 60_000, maxWaitMs: 60_000 });
    await created(store, { id: '71273' });
    await created(store, { id: '71274' });
    await store.update('71273', (record) => ({ ...record, stage: 'planning' }));
    await store.update('71274', (record) => ({ ...record, stage: 'qa' }));

    await store.dispose();
    expect((await readRecordFile('71273')).stage).toBe('planning');
    expect((await readRecordFile('71274')).stage).toBe('qa');

    await store.update('71273', (record) => ({ ...record, stage: 'done' }));
    await vi.waitFor(async () => expect((await readRecordFile('71273')).stage).toBe('done'));
  });
});

describe('killed mid-write', () => {
  it.each<[CrashPoint, TicketRecord['stage']]>([
    ['while-writing-temp-file', 'planning'],
    ['before-rename', 'planning'],
    ['after-rename', 'implementing'],
  ])('%s: the next start reads a whole record (%s) and clears the unfinished write', async (point, expected) => {
    const first = open();
    await created(first);
    await first.update('71273', (record) => ({ ...record, stage: 'planning' }));
    await first.dispose();

    const crashing = createCrashingFs(point);
    const dying = open({ fs: crashing });
    await dying.update('71273', (record) => ({ ...record, stage: 'implementing', title: 'x'.repeat(900) }));
    void dying.flush();
    await crashing.crashed;
    const leftovers = (await listTree(root)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toHaveLength(point === 'after-rename' ? 0 : 1);

    // "Restart": a new store over the same folder, as the app would after being killed.
    const restarted = open();
    expect((await restarted.get('71273'))?.stage).toBe(expected);
    expect(await restarted.issues()).toEqual([]);
    expect(TicketRecordSchema.safeParse(JSON.parse(await readFile(fileOf(), 'utf8'))).success).toBe(true);
    expect((await listTree(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    if (leftovers.length > 0) expect(warn).toHaveBeenCalledWith(expect.stringContaining('Removed 1 unfinished write'));
  });
});

describe('reading damaged or foreign files', () => {
  async function place(name: string, contents: string, repo = input().repo): Promise<string> {
    const file = join(root, repoKey(repo), name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
    return file;
  }

  it('moves a corrupt record aside, reports it, and frees its id', async () => {
    const file = await place('71273.json', '{"version":1,"id":"71273","ti');
    const store = open();

    expect(await store.get('71273')).toBeUndefined();
    const issues = await store.issues();
    expect(issues).toEqual([
      { kind: 'unreadable', file, ticketId: '71273', reason: 'corrupt', movedTo: expect.stringMatching(/71273\.corrupt-.+\.json$/) },
    ]);
    const movedTo = issues[0]?.kind === 'unreadable' ? issues[0].movedTo : null;
    expect(movedTo && (await readFile(movedTo, 'utf8'))).toBe('{"version":1,"id":"71273","ti');

    expect((await store.create(input())).ok).toBe(true);
    // The moved file is not read as a record on the next start.
    const restarted = open();
    expect(await restarted.list()).toHaveLength(1);
    expect(await restarted.issues()).toEqual([]);
  });

  it('moves aside a record that fails validation or names another ticket', async () => {
    const valid = await created(open());
    const invalid = await place('71274.json', JSON.stringify({ ...valid, id: '71274', stage: 'reviewing' }));
    const misnamed = await place('71275.json', JSON.stringify(valid));

    const store = open();
    expect((await store.list()).map((record) => record.id)).toEqual(['71273']);
    expect(await store.issues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unreadable', file: invalid, ticketId: '71274', reason: 'invalid' }),
        expect.objectContaining({ kind: 'unreadable', file: misnamed, ticketId: '71275', reason: 'invalid' }),
      ]),
    );
  });

  it('leaves a record from a newer version alone and never overwrites it', async () => {
    const newer = JSON.stringify({ version: 2, id: '71273', somethingNew: true });
    const file = await place('71273.json', newer);
    const store = open();

    expect(await store.get('71273')).toBeUndefined();
    expect(await store.issues()).toEqual([{ kind: 'newer-version', file, ticketId: '71273', version: 2 }]);
    expect(await store.create(input())).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await readFile(file, 'utf8')).toBe(newer);
  });

  it('uses the newer record when one id has records in two repo folders', async () => {
    const record = await created(open());
    const elsewhere = join(dir, 'moved-repo');
    const newerCopy = { ...record, repo: elsewhere, updatedAt: record.updatedAt + 1, title: 'newer' };
    const newerFile = await place('71273.json', JSON.stringify(newerCopy), elsewhere);

    const store = open();
    expect(await store.get('71273')).toEqual(newerCopy);
    expect(await store.issues()).toEqual([{ kind: 'duplicate', file: fileOf(), ticketId: '71273', keptFile: newerFile }]);
  });

  it('ignores files that are not ticket records', async () => {
    await created(open());
    await place('notes.txt', 'hello');
    await place('AL-2.json', '{}');
    await place('71273.json.bak', '{}');
    await mkdir(join(root, 'stray-folder', 'nested'), { recursive: true });
    await writeFile(join(root, 'top-level.json'), '{}');

    const store = open();
    expect((await store.list()).map((record) => record.id)).toEqual(['71273']);
    expect(await store.issues()).toEqual([]);
  });
});

describe('write failures', () => {
  function flakyFs(): RecordFs & { failing: boolean } {
    const fs = {
      ...nodeRecordFs,
      failing: false,
      async rename(from: string, to: string) {
        if (fs.failing) throw Object.assign(new Error('locked'), { code: 'EACCES' });
        await nodeRecordFs.rename(from, to);
      },
    };
    return fs;
  }

  it('keeps the change in memory, reports it from flush, and saves it once the disk recovers', async () => {
    const fs = flakyFs();
    const store = open({ fs });
    await created(store);
    fs.failing = true;
    await store.update('71273', (record) => ({ ...record, stage: 'planning' }));

    const failed = await store.flush();
    expect(failed).toMatchObject({ ok: false, code: 'INTERNAL', details: { failures: [{ ticketId: '71273' }] } });
    expect((await store.get('71273'))?.stage).toBe('planning');
    expect((await readRecordFile()).stage).toBe('queued');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ticket 71273 not saved'));

    fs.failing = false;
    expect(await store.flush()).toEqual({ ok: true, data: undefined });
    expect((await readRecordFile()).stage).toBe('planning');
  });

  it('retries a failed write on its own after retryMs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const memory = createMemoryRecordFs();
    let failing = false;
    const fs: RecordFs = {
      ...memory,
      rename: (from, to) => (failing ? Promise.reject(Object.assign(new Error('disk error'), { code: 'EIO' })) : memory.rename(from, to)),
    };
    const store = open({ fs, retryMs: 5_000 });
    await created(store);
    failing = true;
    await store.update('71273', (record) => ({ ...record, stage: 'planning' }));
    await vi.advanceTimersByTimeAsync(50);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
    expect(memory.recordWrites).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(memory.recordWrites).toHaveLength(1);

    failing = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(memory.recordWrites).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('saved again'));
  });

  it('reports a create it could not write and keeps the id free', async () => {
    const fs = flakyFs();
    fs.failing = true;
    const store = open({ fs });
    expect(await store.create(input())).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(await store.get('71273')).toBeUndefined();

    fs.failing = false;
    expect((await store.create(input())).ok).toBe(true);
  });
});

describe('delete', () => {
  it('removes the record and its file, and a pending change never brings it back', async () => {
    const store = open();
    await created(store);
    await store.update('71273', (record) => ({ ...record, stage: 'planning' }));

    expect(await store.delete('71273')).toEqual({ ok: true, data: true });
    expect(await store.get('71273')).toBeUndefined();
    await store.flush();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await listTree(root)).toEqual([`${repoKey(input().repo)}/`]);
    expect(await store.delete('71273')).toEqual({ ok: true, data: false });
    expect((await store.create(input())).ok).toBe(true);
  });
});

describe('never inside a worktree', () => {
  it('refuses a record that would be written inside its worktree or repo, and writes nothing', async () => {
    const ticket = input();
    for (const folder of [ticket.worktreePath, ticket.repo]) {
      const store = createTicketRecordStore({ rootDir: join(folder, 'profile', 'tickets'), warn });
      const result = await store.create(ticket);
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION', message: expect.stringContaining('inside') });
    }
    expect(await listTree(dir)).toEqual([]);
  });

  it('refuses a sub-branch worktree that holds the record folder', async () => {
    const store = open();
    const record = await created(store);
    const result = await store.update('71273', (current) => ({
      ...current,
      subBranches: [{ name: 'grid', branch: 'sub/71273-grid', worktreePath: join(dir, 'userData'), createdAt: START, mergedAt: null }],
    }));

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await store.get('71273')).toEqual(record);
  });
});
