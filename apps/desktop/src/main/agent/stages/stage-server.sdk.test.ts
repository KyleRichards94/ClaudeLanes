import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTicketRecordStore, type TicketRecordStore } from '../../tickets';
import { createMemoryRecordFs, createTempDir, newTicketInput } from '../../tickets/testing';
import { createClaudeLauncher, loadClaudeSdk } from '../claude-sdk';
import { createSessionManager, type SessionManager } from '../session-manager';
import { eventually, fakeClaudeConnections, recordingEmit } from '../testing/sessions';
import { sdkStageServer, stageSessionExtras } from './stage-server';
import { createStageService, type StageService } from './stage-service';

/**
 * AL-222's scripted agent with the real Agent SDK: the e2e stand-in for `claude`
 * (`e2e/fixtures/fake-claude-code.mjs`) calls `set_stage` on the in-process `agent_lanes` server the
 * way the real CLI's MCP client does, waits on the Planning gate until the user approves, then
 * commits in its worktree. This is the protocol the golden-path e2e relies on.
 */

const FAKE_CLI = fileURLToPath(new URL('../../../../e2e/fixtures/fake-claude-code.mjs', import.meta.url));
const TIMEOUT = 60_000;

let temp: { dir: string; remove: () => Promise<void> };
let logPath: string;
let tickets: TicketRecordStore;
let stages: StageService;
let sessions: SessionManager;
let worktree: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Agent Lanes Test', '-c', 'user.email=test@agent-lanes.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

beforeEach(async () => {
  temp = await createTempDir('agent-lanes-stage-sdk-');
  logPath = join(temp.dir, 'fake-claude.log');
  const statePath = join(temp.dir, 'fake-claude.json');
  await writeFile(
    statePath,
    JSON.stringify({
      login: { email: 'kyle@example.test', organization: 'Companion Systems' },
      log: logPath,
      lead: {
        turns: [
          {
            steps: [
              { tool: 'report_activity', input: { text: 'Writing the plan', progress: 50 } },
              { tool: 'set_stage', input: { stage: 'implementing', summary: 'Plan ready: one file' } },
              { commit: { file: 'src/JobGrid.razor', content: '<JobGrid />\n', message: 'Add JobGrid' } },
              { text: 'Implemented the plan.' },
            ],
          },
        ],
      },
    }),
  );

  tickets = createTicketRecordStore({ rootDir: join(temp.dir, 'user-data', 'tickets'), fs: createMemoryRecordFs(), warn: () => undefined });
  const input = newTicketInput(temp.dir, { id: '71273', branch: '71273-work' });
  await mkdir(input.repo, { recursive: true });
  git(input.repo, 'init', '--quiet', '--initial-branch=main');
  git(input.repo, 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  git(input.repo, 'worktree', 'add', '--quiet', '-b', '71273-work', input.worktreePath, 'main');
  worktree = input.worktreePath;
  const created = await tickets.create(input);
  if (!created.ok) throw new Error(created.message);

  const { emit } = recordingEmit();
  stages = createStageService({ tickets, emit, userName: () => 'Kyle' });
  const claude = createClaudeLauncher({
    executable: () => FAKE_CLI,
    baseEnv: () => ({ ...process.env, AGENT_LANES_FAKE_CLAUDE_STATE: statePath }),
    clientApp: 'agent-lanes/test',
  });
  sessions = createSessionManager({
    claude,
    connections: fakeClaudeConnections('login'),
    tickets,
    emit,
    extras: stageSessionExtras({ stages, createServer: sdkStageServer(loadClaudeSdk) }),
  });
});

afterEach(async () => {
  await sessions.dispose();
  await temp.remove();
});

describe('the scripted fake claude with the real stage server', () => {
  it(
    'waits on the Planning gate, moves to Implementing once approved and commits in its worktree',
    async () => {
      await sessions.start({ ticketId: '71273', jobDescription: 'Cutover frmJobControl' });

      // The agent asked to leave Planning; the gate holds it there until the user decides.
      await eventually(() => stages.pendingGate('71273') !== null, TIMEOUT);
      expect(stages.pendingGate('71273')).toMatchObject({ stage: 'planning', to: 'implementing', summary: 'Plan ready: one file' });
      expect((await tickets.get('71273'))?.stage).toBe('planning');

      expect(stages.resolveGate('71273', { approve: true })).toBe(true);
      await eventually(() => sessions.status('71273').state === 'idle', TIMEOUT);
      expect((await tickets.get('71273'))?.stage).toBe('implementing');
      expect(git(worktree, 'log', '-1', '--format=%s')).toBe('Add JobGrid');
      expect(git(worktree, 'status', '--porcelain')).toBe('');

      await sessions.stop('71273');
      await eventually(() => sessions.status('71273').state === 'stopped', TIMEOUT);
      const started = await readFile(logPath, 'utf8')
        .then((text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { tools: Array<{ tool: string; text: string }> }))
        .catch(() => []);
      expect(started[0]?.tools.map((call) => [call.tool, call.text])).toEqual([
        ['report_activity', 'Noted.'],
        ['set_stage', 'Approved by Kyle. Moved to Implementing.'],
      ]);
    },
    TIMEOUT * 2,
  );
});
