import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TicketRecordSchema } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTicketRecordStore } from './record-store';
import { createTempDir, listTree } from './testing';

/**
 * Acceptance criterion: killing the app mid-write never corrupts a record. A real Node process
 * rewrites ticket records through the store as fast as it can, and the test kills it (SIGKILL,
 * TerminateProcess on Windows) at a different moment each round. After every kill, each record
 * file on disk must still parse and validate, and a fresh store must load every ticket with no
 * issues and clear the unfinished write.
 */

const CHILD = fileURLToPath(new URL('./testing/crash-writer.ts', import.meta.url));
const HOOKS = new URL('./testing/strip-types-hooks.mjs', import.meta.url).href;
const TICKETS = 8;
/** Milliseconds between "ready" and the kill, one per round. */
const KILL_DELAYS = [5, 30, 12, 60, 21, 45, 8, 90, 17, 70, 3, 38, 26, 52];

let dir: string;
let remove: () => Promise<void>;
let root: string;
let child: ChildProcess | undefined;

beforeEach(async () => {
  ({ dir, remove } = await createTempDir());
  root = join(dir, 'userData', 'tickets');
});

afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  await remove();
});

function startWriter(): Promise<ChildProcess> {
  const writer = spawn(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', HOOKS, CHILD, root, dir, String(TICKETS)],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  child = writer;
  let stderr = '';
  writer.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    let stdout = '';
    writer.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes('ready\n')) resolve(writer);
    });
    writer.once('exit', (code) => reject(new Error(`crash writer exited (${code}) before it was ready:\n${stderr}`)));
    writer.once('error', reject);
  });
}

async function recordFiles(): Promise<string[]> {
  return (await listTree(root)).filter((name) => /\/\d+\.json$/.test(name)).map((name) => join(root, name));
}

describe('ticket records when the app is killed mid-write', () => {
  it('never leaves a corrupt record', { timeout: 120_000 }, async () => {
    let killedMidWrite = 0;

    for (const delay of KILL_DELAYS) {
      const writer = await startWriter();
      await new Promise((resolve) => setTimeout(resolve, delay));
      writer.kill('SIGKILL');
      await once(writer, 'exit');

      const tree = await listTree(root);
      if (tree.some((name) => name.endsWith('.tmp'))) killedMidWrite += 1;

      // Every record file is whole as the killed process left it, before anything tidies up.
      const files = await recordFiles();
      expect(files).toHaveLength(TICKETS);
      for (const file of files) {
        const parsed = TicketRecordSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
        expect(parsed.success, `${file} after a kill ${delay} ms into writing`).toBe(true);
      }

      // The next start loads every ticket, reports nothing, and removes the unfinished write.
      const store = createTicketRecordStore({ rootDir: root, warn: () => undefined });
      expect(await store.list()).toHaveLength(TICKETS);
      expect(await store.issues()).toEqual([]);
      expect((await listTree(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    }

    // The kills really did interrupt writes (the writer spends nearly all its time inside one).
    expect(killedMidWrite).toBeGreaterThan(0);
  });
});
