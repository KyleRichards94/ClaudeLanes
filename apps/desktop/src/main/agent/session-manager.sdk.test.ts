import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets';
import { createMemoryRecordFs, createTempDir, newTicketInput } from '../tickets/testing';
import { createClaudeLauncher } from './claude-sdk';
import { createSessionManager, type SessionManager } from './session-manager';
import { eventually, fakeClaudeConnections, recordingEmit } from './testing/sessions';

/**
 * AL-100 with the real Agent SDK: it starts the e2e stand-in for the `claude` binary
 * (`e2e/fixtures/fake-claude-code.mjs`, which speaks the SDK's stream-json protocol and contacts
 * nothing) once per ticket, in that ticket's worktree. Proves two sessions don't cross-talk and that
 * closing a session ends its process.
 */

const FAKE_CLI = fileURLToPath(new URL('../../../e2e/fixtures/fake-claude-code.mjs', import.meta.url));
const TIMEOUT = 60_000;

interface FakeStart {
  cwd: string;
  pid: number;
  prompts: string[];
  argv: string[];
}

let temp: { dir: string; remove: () => Promise<void> };
let logPath: string;
let tickets: TicketRecordStore;
let sessions: SessionManager;

async function starts(): Promise<FakeStart[]> {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeStart);
}

/** Polls the fake's log until it holds a start in `cwd` (written when that process exits). */
async function startIn(cwd: string | undefined): Promise<FakeStart | undefined> {
  for (const begun = Date.now(); Date.now() - begun < TIMEOUT; await new Promise((resolve) => setTimeout(resolve, 20))) {
    const found = (await starts()).find((entry) => entry.cwd === cwd);
    if (found) return found;
  }
  return undefined;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  temp = await createTempDir('agent-lanes-sessions-');
  logPath = join(temp.dir, 'fake-claude.log');
  const statePath = join(temp.dir, 'fake-claude.json');
  await writeFile(statePath, JSON.stringify({ login: { email: 'kyle@example.test', organization: 'Companion Systems' }, log: logPath }));

  tickets = createTicketRecordStore({ rootDir: join(temp.dir, 'user-data', 'tickets'), fs: createMemoryRecordFs(), warn: () => undefined });
  for (const id of ['71273', '71274']) {
    const input = newTicketInput(temp.dir, { id, branch: `${id}-work` });
    await mkdir(input.repo, { recursive: true });
    await mkdir(input.worktreePath, { recursive: true });
    const created = await tickets.create(input);
    if (!created.ok) throw new Error(created.message);
  }

  const claude = createClaudeLauncher({
    executable: () => FAKE_CLI,
    baseEnv: () => ({ ...process.env, AGENT_LANES_FAKE_CLAUDE_STATE: statePath }),
    clientApp: 'agent-lanes/test',
  });
  sessions = createSessionManager({ claude, connections: fakeClaudeConnections('login'), tickets, emit: recordingEmit().emit });
});

afterEach(async () => {
  await sessions.dispose();
  await temp.remove();
});

describe('session manager with the real Agent SDK', () => {
  it(
    'runs two tickets in their own worktrees and processes, and stopping one ends only its process',
    async () => {
      await Promise.all([
        sessions.start({ ticketId: '71273', jobDescription: 'job for 71273' }),
        sessions.start({ ticketId: '71274', jobDescription: 'job for 71274' }),
      ]);
      await eventually(() => sessions.status('71273').state === 'idle' && sessions.status('71274').state === 'idle', TIMEOUT);

      expect(sessions.send('71273', { text: 'only for 71273' }).ok).toBe(true);
      await eventually(() => sessions.status('71273').state === 'idle', TIMEOUT);

      await sessions.stop('71273');
      const a = (await startIn((await tickets.get('71273'))?.worktreePath))!;
      expect(a).toBeDefined();
      expect(a.prompts).toHaveLength(2);
      expect(a.prompts[0]).toContain('job for 71273');
      expect(a.prompts[1]).toBe('only for 71273');
      expect(a.argv.join(' ')).toContain('--model claude-opus-5-5');
      await eventually(() => !alive(a.pid), TIMEOUT);

      // 71274 is still running: its process has not exited (nothing logged yet) and never saw 71273's turn.
      expect(sessions.status('71274').state).toBe('idle');
      expect(await starts()).toHaveLength(1);

      await sessions.stop('71274');
      await eventually(() => sessions.status('71274').state === 'stopped', TIMEOUT);
      const b = await startIn((await tickets.get('71274'))?.worktreePath);
      expect(b).toBeDefined();
      expect(b?.prompts).toEqual([expect.stringContaining('job for 71274')]);
      await eventually(() => !alive(b!.pid), TIMEOUT);

      // Each session id was saved on its own ticket, so either can be resumed (AL-110).
      const ids = [(await tickets.get('71273'))?.sessionId, (await tickets.get('71274'))?.sessionId];
      expect(ids.every(Boolean)).toBe(true);
      expect(ids[0]).not.toBe(ids[1]);
    },
    TIMEOUT * 3,
  );
});
