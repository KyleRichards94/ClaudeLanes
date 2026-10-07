import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultStageGates, ok, type RepoCommands, type RunStatus, type TicketRecord } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Emit } from '../../ipc/emit';
import { createTicketRecord } from '../../tickets';
import { createRunService, type RunService } from './run-service';

/**
 * AL-133 acceptance: two tickets run the same web app side by side on different ports. Real child
 * processes: a small node web server that listens on $PORT and says which worktree it serves.
 */

const SERVER = `
const http = require('http');
const path = require('path');
const name = path.basename(process.cwd());
const server = http.createServer((req, res) => res.end('served from ' + name));
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log('pid=' + process.pid);
  console.log('Now listening on: http://localhost:' + server.address().port);
});
`;

let root: string;
let service: RunService;
const pids: number[] = [];

function record(id: string, worktreePath: string): TicketRecord {
  return createTicketRecord(
    { id, title: id, ado: null, repo: root, baseBranch: 'main', branch: id, worktreePath, model: 'opus', effort: 'xhigh', gates: defaultStageGates(), skills: [] },
    1,
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-run-side-by-side-'));
  const records = new Map<string, TicketRecord>();
  for (const id of ['71273', '71288']) {
    const worktree = join(root, id);
    mkdirSync(worktree);
    writeFileSync(join(worktree, 'server.js'), SERVER);
    records.set(id, record(id, worktree));
  }
  const commands: RepoCommands = { repoPath: root, detected: null, build: null, run: { command: 'node server.js', origin: 'override' } };
  service = createRunService({
    tickets: {
      get: (id) => Promise.resolve(records.get(id)),
      update: (id, change) => {
        const next = change(records.get(id)!);
        records.set(id, next);
        return Promise.resolve(ok(next));
      },
    },
    buildCommands: { forRepo: () => Promise.resolve(ok(commands)) },
    builds: { build: vi.fn(), isStale: () => Promise.resolve(false) },
    emit: ((channel: string, payload: { lines?: { text: string }[] }) => {
      if (channel !== 'build:log') return;
      for (const line of payload.lines ?? []) {
        const pid = /^pid=(\d+)$/.exec(line.text)?.[1];
        if (pid) pids.push(Number(pid));
      }
    }) as unknown as Emit,
    openExternal: () => Promise.resolve(),
    logBatchMs: 1,
  });
});

afterEach(async () => {
  // Stop (AL-134) is not part of this ticket: end the servers by their own pids.
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function running(ticketId: string): Promise<RunStatus> {
  let status: RunStatus | undefined;
  await vi.waitFor(
    () => {
      status = service.list().find((run) => run.ticketId === ticketId);
      expect(status?.state).toBe('running');
      expect(status?.url).not.toBeNull();
    },
    { timeout: 15_000, interval: 50 },
  );
  return status!;
}

describe('run service, side by side', () => {
  it('runs the same web app for two tickets on different ports', { timeout: 30_000 }, async () => {
    await expect(service.start('71273')).resolves.toMatchObject({ ok: true });
    await expect(service.start('71288')).resolves.toMatchObject({ ok: true });

    const first = await running('71273');
    const second = await running('71288');
    expect(first.port).not.toBe(second.port);
    expect(first.url).toBe(`http://localhost:${first.port}/`);
    expect(second.url).toBe(`http://localhost:${second.port}/`);

    const fetchText = async (port: number | null) => (await fetch(`http://127.0.0.1:${port}/`)).text();
    await expect(fetchText(first.port)).resolves.toBe('served from 71273');
    await expect(fetchText(second.port)).resolves.toBe('served from 71288');
    await vi.waitFor(() => expect(pids).toHaveLength(2));
  });
});
