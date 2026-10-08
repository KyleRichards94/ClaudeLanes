import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adoMcpCredential, adoMcpServerFor, createConnectionsService, createMemoryConnectionsFile } from '../../connections';
import { SECRETS_FILE_NAME, createSecretStore } from '../../secrets';
import { createFakeSafeStorage } from '../../secrets/testing';
import { createClaudeLauncher } from '../claude-sdk';
import { combineSessionExtras } from '../session-extras';
import { createSessionManager } from '../session-manager';
import { STAGE_SERVER_NAME, STAGE_SERVER_TOOLS, stageSessionExtras } from '../stages/stage-server';
import { createStageService } from '../stages/stage-service';
import { createFakeClaude, fakeInit } from '../testing/fake-claude';
import { fakeClaudeConnections, memoryTickets, recordingEmit } from '../testing/sessions';
import { WORK_ITEM_COMMENT_RULE } from '../permissions/policy';
import { ADO_MCP_ALLOWED_TOOLS, mcpSessionExtras } from './session-mcp';

/** Made up for these tests; shaped like real tokens, valid nowhere. */
const PAT = 'fakepat0000session1111mcp2222never3333real4444Ab12';
const MCP_TOKEN = 'ghp_fakeSession0000000000000000000Mcp2';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-session-mcp-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function connectionsWith(options: { ado?: boolean; github?: boolean } = {}) {
  const secrets = createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key: randomBytes(32) }), warn: () => undefined });
  const connections = createConnectionsService({
    file: createMemoryConnectionsFile(),
    secrets,
    emit: () => undefined,
    testers: { ado: async () => ({ status: 'ok', identity: 'Kyle Richards', message: null }) },
    adoMcpServer: adoMcpServerFor,
    platform: 'linux',
    warn: () => undefined,
  });
  if (options.ado !== false) {
    const saved = await connections.save({ kind: 'ado', orgUrl: 'https://dev.azure.com/Contoso', pat: PAT });
    if (!saved.ok) throw new Error(saved.message);
  }
  if (options.github) {
    const saved = await connections.save({
      kind: 'mcp',
      name: 'GitHub',
      transport: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
      token: MCP_TOKEN,
    });
    if (!saved.ok) throw new Error(saved.message);
  }
  return connections;
}

describe('MCP servers injected into each session (AL-108)', () => {
  it("gives the session its work item's Azure DevOps server with the PAT, the user's servers and the stage server", async () => {
    const connections = await connectionsWith({ github: true });
    const tickets = await memoryTickets({ id: '71273' });
    const emit = recordingEmit().emit;
    const stages = createStageService({ tickets, emit });
    const extras = combineSessionExtras([
      stageSessionExtras({ stages, createServer: () => ({ type: 'sdk', name: STAGE_SERVER_NAME, instance: {} as never }) }),
      mcpSessionExtras({ connections }),
    ]);
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
    const sessions = createSessionManager({
      claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
      connections: fakeClaudeConnections(),
      tickets,
      emit,
      extras,
    });

    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    const call = fake.calls[0]!;
    await call.sentCount(1);

    const servers = call.options.mcpServers ?? {};
    expect(Object.keys(servers).sort()).toEqual([STAGE_SERVER_NAME, 'azure-devops', 'github'].sort());
    expect(servers['azure-devops']).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@azure-devops/mcp', 'Contoso', '--authentication', 'pat'],
      env: { PERSONAL_ACCESS_TOKEN: adoMcpCredential(PAT) },
    });
    expect(servers['github']).toMatchObject({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: MCP_TOKEN } });
    expect(call.options.allowedTools).toEqual([...STAGE_SERVER_TOOLS, ...ADO_MCP_ALLOWED_TOOLS]);
    // Reading is pre-approved; commenting is not: the permission policy lets only QA failure reports and answers through.
    expect(ADO_MCP_ALLOWED_TOOLS).toEqual(['mcp__azure-devops__wit_get_work_item', 'mcp__azure-devops__wit_list_work_item_comments']);

    // The first turn tells the agent where its work item is and which server reads and comments on it.
    const first = (call.sent[0] as SDKUserMessage).message.content as string;
    expect(first).toContain('#71273');
    expect(first).toContain('`azure-devops` MCP server');
    expect(first).not.toContain('add comments');
    expect(first).toContain(WORK_ITEM_COMMENT_RULE);
    expect(call.options.systemPrompt).toMatchObject({ append: expect.stringContaining(WORK_ITEM_COMMENT_RULE) });
    await sessions.dispose();
  });

  it('gives a "No ticket" ticket only the user servers, and none of the Azure DevOps tools', async () => {
    const connections = await connectionsWith({ github: true });
    const tickets = await memoryTickets({ id: 'nt-20261008-fix-login', ado: null });
    const record = (await tickets.get('nt-20261008-fix-login'))!;
    const extras = await mcpSessionExtras({ connections })(record);
    expect(Object.keys(extras.mcpServers ?? {})).toEqual(['github']);
    expect(extras.allowedTools).toEqual([]);
    expect(extras.firstTurnAppendix).toEqual([]);
  });

  it("starts without the ADO server when the work item's organisation is not connected", async () => {
    const connections = await connectionsWith({ ado: false });
    const tickets = await memoryTickets({ id: '71273' });
    const warnings: string[] = [];
    const extras = await mcpSessionExtras({ connections, log: { warn: (message) => warnings.push(message) } })((await tickets.get('71273'))!);
    expect(extras.mcpServers).toEqual({});
    expect(extras.allowedTools).toEqual([]);
  });

  it('matches the organisation whatever its case or trailing slash', async () => {
    const connections = await connectionsWith();
    const tickets = await memoryTickets({ id: '71273', ado: { orgUrl: 'https://dev.azure.com/contoso/', project: 'OnSite', workItemId: 71273 } });
    const extras = await mcpSessionExtras({ connections })((await tickets.get('71273'))!);
    expect(Object.keys(extras.mcpServers ?? {})).toEqual(['azure-devops']);
  });
});
