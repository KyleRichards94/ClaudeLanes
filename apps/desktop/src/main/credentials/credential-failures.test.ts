import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ADO_FIXTURE_PAT, createFakeAdoOrg, type FakeAdoOrg } from '@agent-lanes/ado-client/testing';
import type { FetchLike } from '@agent-lanes/ado-client';
import { ADO_FIXTURE_ORG_ID, ADO_FIXTURE_ORG_URL } from '@agent-lanes/contracts/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdoService } from '../ado/service';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { RESUME_MESSAGE, createSessionManager } from '../agent/session-manager';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult, type FakeClaudeCall } from '../agent/testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from '../agent/testing/sessions';
import { createConnectionsService, type ConnectionsService } from '../connections';
import { createMemoryConnectionsFile } from '../connections/connections-file';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createSettingsService } from '../settings/service';
import { createMemorySettingsFile } from '../settings/settings-file';
import {
  ADO_UNAUTHORIZED_STATUS_MESSAGE,
  CONNECTION_RESTORED_MESSAGE,
  adoUnauthorizedToastId,
  createCredentialFailureService,
  type CredentialFailureService,
} from './credential-failures';

/**
 * AL-048 with the real connections service, SecretStore (fake safeStorage), ADO service against the
 * shared fake organisations, and the session manager on the fake Agent SDK. Nothing leaves the process.
 */

const FABRIKAM_URL = 'https://dev.azure.com/fabrikam';
/** Made up; shaped like real PATs and valid nowhere. */
const FABRIKAM_PAT = 'fakepatAL048fabrikam000only1111never2222real3333zzF4';
const REVOKED_PAT = 'fakepatAL048revoked0000only1111never2222real3333zzR1';

const JOB = 'Cut frmJobControl over to Blazor.';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-credentials-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function route(...orgs: FakeAdoOrg[]): FetchLike {
  return (input, init) => {
    const org = orgs.find((candidate) => input.startsWith(`${candidate.orgUrl}/`));
    return org ? org.fetch(input, init) : Promise.reject(new Error(`No fake organisation for ${input}`));
  };
}

/** Three tickets: two on contoso, one on fabrikam, plus one without a work item. */
async function setup() {
  const contoso = createFakeAdoOrg();
  const fabrikam = createFakeAdoOrg({ orgUrl: FABRIKAM_URL, pat: FABRIKAM_PAT });
  const events = recordingEmit();
  const secrets = createSecretStore({
    filePath: join(dir, SECRETS_FILE_NAME),
    safeStorage: createFakeSafeStorage({ key: randomBytes(32) }),
    warn: () => undefined,
  });
  const late: { failures?: CredentialFailureService } = {};
  const connections = createConnectionsService({
    file: createMemoryConnectionsFile(),
    secrets,
    emit: events.emit,
    warn: () => undefined,
    onChanged: () => void late.failures?.connectionsChanged(),
  });
  const settings = createSettingsService({ file: createMemorySettingsFile(), warn: () => undefined });
  const ado = createAdoService({
    connections,
    settings,
    fetch: route(contoso, fabrikam),
    onUnauthorized: (id) => void late.failures?.adoUnauthorized(id),
  });

  const fake = createFakeClaude({
    live: true,
    messages: [fakeInit('session')],
    onSend: (message) => [fakeAssistant(`echo: ${String(message.message.content).slice(0, 30)}`), fakeResult()],
  });
  const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query, baseEnv: () => ({}) });
  const tickets = await memoryTickets(
    { id: '71273' },
    { id: '71274', title: 'Job filter date range' },
    { id: '80001', title: 'Fabrikam asset register', ado: { orgUrl: FABRIKAM_URL, project: 'Assets', workItemId: 80001 } },
    { id: 'nt-20261008-tidy-logs', title: 'Tidy logs', ado: null },
  );
  const claudeConnections: Pick<ConnectionsService, 'get' | 'secret'> = fakeClaudeConnections('login');
  const sessions = createSessionManager({ claude, connections: claudeConnections, tickets, emit: events.emit });
  const failures = createCredentialFailureService({ connections, sessions, tickets, emit: events.emit });
  late.failures = failures;

  const saved = await connections.save({ kind: 'ado', orgUrl: ADO_FIXTURE_ORG_URL, pat: ADO_FIXTURE_PAT, defaultProject: 'OnSite Companion' });
  const savedFabrikam = await connections.save({ kind: 'ado', orgUrl: FABRIKAM_URL, pat: FABRIKAM_PAT, defaultProject: 'Assets' });
  if (!saved.ok || !savedFabrikam.ok) throw new Error('could not save the connections');

  const ids = ['71273', '71274', '80001', 'nt-20261008-tidy-logs'];
  for (const ticketId of ids) {
    const started = await sessions.start({ ticketId, jobDescription: JOB });
    if (!started.ok) throw new Error(started.message);
  }
  const callOf = (ticketId: string): FakeClaudeCall => {
    const call = fake.calls.find((candidate) => candidate.options.cwd?.endsWith(ticketId));
    if (!call) throw new Error(`no session for ${ticketId}`);
    return call;
  };
  // Every first turn delivered and answered.
  for (const ticketId of ids) await callOf(ticketId).sentCount(1);
  await eventually(() => ids.every((ticketId) => sessions.status(ticketId).state === 'idle'));

  return { connections, ado, sessions, failures, events, callOf, fabrikamId: savedFabrikam.data.id, contoso };
}

/** Replaces contoso's PAT; `REVOKED_PAT` makes the fake organisation answer 401. */
async function replaceContosoPat(connections: ConnectionsService, pat: string): Promise<void> {
  const replaced = await connections.replace({ id: ADO_FIXTURE_ORG_ID, draft: { kind: 'ado', orgUrl: ADO_FIXTURE_ORG_URL, pat } });
  if (!replaced.ok) throw new Error(replaced.message);
}

describe('credential failure handling (AL-048)', () => {
  it('a 401 from the ADO client turns that org red, pauses only its agents and raises a Reconnect toast', async () => {
    const { connections, ado, sessions, failures, events, callOf, fabrikamId } = await setup();
    await replaceContosoPat(connections, REVOKED_PAT);

    expect(await ado.getWorkItem({ id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    await failures.settled();

    // The org is red, with a reason the row can show.
    expect(await connections.get(ADO_FIXTURE_ORG_ID)).toMatchObject({ status: 'error', statusMessage: ADO_UNAUTHORIZED_STATUS_MESSAGE });
    expect(await connections.get(fabrikamId)).toMatchObject({ status: 'untested' });

    // Only contoso's agents are paused (interrupted, input held); fabrikam's and the no-ticket one keep running.
    expect(sessions.status('71273').state).toBe('paused');
    expect(sessions.status('71274').state).toBe('paused');
    expect(callOf('71273').interrupts).toBe(1);
    expect(sessions.status('80001').state).toBe('idle');
    expect(sessions.status('nt-20261008-tidy-logs').state).toBe('idle');
    expect(callOf('80001').interrupts).toBe(0);
    expect(failures.pausedFor(ADO_FIXTURE_ORG_ID).sort()).toEqual(['71273', '71274']);

    // Agents on another org keep running: a message to fabrikam's agent is delivered and answered.
    expect(sessions.send('80001', { text: 'Carry on with the paging.' })).toEqual({ ok: true, data: { held: false } });
    await callOf('80001').sentCount(2);
    // …while contoso's agents hold theirs.
    expect(sessions.send('71273', { text: 'Also check the filters.' })).toEqual({ ok: true, data: { held: true } });

    const toasts = events.of('toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      id: adoUnauthorizedToastId(ADO_FIXTURE_ORG_ID),
      tone: 'error',
      title: 'Azure DevOps refused the token for contoso',
      actions: [{ label: 'Reconnect', intent: { type: 'openConnections', connectionId: ADO_FIXTURE_ORG_ID } }],
    });
    expect(String(toasts[0]!['body'])).toContain('#71273, #71274');

    // Nothing that crossed to the renderer carries a token.
    const sent = JSON.stringify(events.events);
    for (const token of [ADO_FIXTURE_PAT, REVOKED_PAT, FABRIKAM_PAT]) expect(sent).not.toContain(token);
    await sessions.dispose();
  });

  it('a repeated 401 does not raise the toast again or pause twice', async () => {
    const { connections, ado, failures, events, callOf } = await setup();
    await replaceContosoPat(connections, REVOKED_PAT);
    await ado.getWorkItem({ id: 71273 });
    await ado.getWorkItem({ id: 71274 });
    await failures.settled();
    expect(events.of('toast')).toHaveLength(1);
    expect(callOf('71273').interrupts).toBe(1);
  });

  it('reconnecting resumes the paused agents with a "Connection restored" turn, then their held messages', async () => {
    const { connections, ado, sessions, failures, events, callOf } = await setup();
    await replaceContosoPat(connections, REVOKED_PAT);
    await ado.getWorkItem({ id: 71273 });
    await failures.settled();
    sessions.send('71273', { text: 'Also check the filters.' });

    // Reconnect: the user replaces the token in Connections (the Reconnect toast opened it on this row).
    await replaceContosoPat(connections, ADO_FIXTURE_PAT);
    await eventually(() => sessions.status('71273').state !== 'paused');
    await failures.settled();

    expect(sessions.status('71274').state).not.toBe('paused');
    const call = callOf('71273');
    await call.sentCount(3);
    expect(call.sent.slice(1).map((message) => message.message.content)).toEqual([CONNECTION_RESTORED_MESSAGE, 'Also check the filters.']);
    expect(callOf('71274').sent.at(-1)?.message.content).toBe(CONNECTION_RESTORED_MESSAGE);
    expect(call.sent.some((message) => message.message.content === RESUME_MESSAGE)).toBe(false);

    // The agent works on: a reply arrives and the session goes idle again.
    await eventually(() => sessions.status('71273').state === 'idle');
    expect(failures.pausedFor(ADO_FIXTURE_ORG_ID)).toEqual([]);
    expect(await ado.getWorkItem({ id: 71273 })).toMatchObject({ ok: true });

    // The error toast is replaced in place by a notice that closes itself.
    expect(events.of('toast').at(-1)).toMatchObject({ id: adoUnauthorizedToastId(ADO_FIXTURE_ORG_ID), tone: 'info', title: 'contoso reconnected' });
    await sessions.dispose();
  });

  it('leaves an agent the user paused before the 401 paused after a reconnect', async () => {
    const { connections, ado, sessions, failures, callOf } = await setup();
    await sessions.pause('71274');
    await replaceContosoPat(connections, REVOKED_PAT);
    await ado.getWorkItem({ id: 71273 });
    await failures.settled();
    expect(failures.pausedFor(ADO_FIXTURE_ORG_ID)).toEqual(['71273']);

    await replaceContosoPat(connections, ADO_FIXTURE_PAT);
    await eventually(() => sessions.status('71273').state !== 'paused');
    expect(sessions.status('71274').state).toBe('paused');
    expect(callOf('71274').sent).toHaveLength(1);
    await sessions.dispose();
  });

  it('a re-test that still fails keeps the agents paused', async () => {
    const { connections, ado, sessions, failures } = await setup();
    await replaceContosoPat(connections, REVOKED_PAT);
    await ado.getWorkItem({ id: 71273 });
    await failures.settled();
    // A scope change or any other edit that leaves the row red does not resume anything.
    await connections.markUnauthorized(ADO_FIXTURE_ORG_ID, 'still refused');
    await failures.settled();
    expect(sessions.status('71273').state).toBe('paused');
    await sessions.dispose();
  });

  it('a 401 the ADO MCP server reports inside a session pauses the agents of that session’s org', async () => {
    const { connections, sessions, failures, events, callOf } = await setup();
    const call = callOf('71274');
    call.push(
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_ado_1', name: 'mcp__azure-devops__wit_get_work_item', input: { id: 71274 } }] },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000001',
        session_id: 'session',
      } as unknown as SDKMessage,
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_ado_1', is_error: true, content: [{ type: 'text', text: 'Error: Request failed with status code 401 (Unauthorized)' }] }],
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000002',
        session_id: 'session',
      } as unknown as SDKMessage,
    );
    await eventually(() => sessions.status('71273').state === 'paused');
    await failures.settled();

    expect(sessions.status('71274').state).toBe('paused');
    expect(sessions.status('80001').state).toBe('idle');
    expect(await connections.get(ADO_FIXTURE_ORG_ID)).toMatchObject({ status: 'error' });
    expect(events.of('toast')).toHaveLength(1);
    await sessions.dispose();
  });

  it('ignores ADO MCP results that are not a 401, and other tools that mention 401', async () => {
    const { sessions, failures, callOf } = await setup();
    const call = callOf('71273');
    const tool = (id: string, name: string, text: string): SDKMessage[] => [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] },
        parent_tool_use_id: null,
        uuid: `00000000-0000-4000-8000-0000000000${id.slice(-2)}`,
        session_id: 'session',
      } as unknown as SDKMessage,
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
        parent_tool_use_id: null,
        uuid: `00000000-0000-4000-8000-0000000001${id.slice(-2)}`,
        session_id: 'session',
      } as unknown as SDKMessage,
    ];
    call.push(...tool('toolu_10', 'mcp__azure-devops__wit_get_work_item', '{"id":71273,"fields":{}}'), ...tool('toolu_11', 'Bash', 'curl: (22) The requested URL returned error: 401'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await failures.settled();
    expect(sessions.status('71273').state).toBe('idle');
    await sessions.dispose();
  });
});
