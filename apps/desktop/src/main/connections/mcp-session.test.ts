import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { adoMcpCredential, adoMcpServerFor } from './ado-mcp';
import { mcpHeaderValue, toMcpSessionConfig, uniqueSessionName, type McpSessionConfig } from './mcp-session';

/** Made up for these tests; valid nowhere. */
const TOKEN = 'ghp_fakeSession0000000000000000000000Mcp1';
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';

describe('MCP session config (AL-045, for AL-108)', () => {
  it('stays assignable to the Agent SDK’s mcpServers entries', () => {
    const config: McpSessionConfig = toMcpSessionConfig({ type: 'http', url: 'https://mcp.example.test/mcp', header: null }, undefined);
    const sdk: McpServerConfig = config;
    expect(sdk.type).toBe('http');
  });

  it('puts a stdio server’s token in the env var the user named, never in its args', () => {
    const config = toMcpSessionConfig(
      { type: 'stdio', command: 'uvx', args: ['mcp-server-github'], envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
      TOKEN,
      'linux',
    );
    expect(config).toEqual({ type: 'stdio', command: 'uvx', args: ['mcp-server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: TOKEN } });
  });

  it('gives a server without a token no env', () => {
    expect(toMcpSessionConfig({ type: 'stdio', command: 'node', args: ['server.js'], envVar: null }, undefined, 'linux')).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: {},
    });
  });

  it('starts .cmd shims through cmd /c on Windows only', () => {
    const transport = { type: 'stdio' as const, command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVar: null };
    expect(toMcpSessionConfig(transport, undefined, 'win32')).toMatchObject({ command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-github'] });
    expect(toMcpSessionConfig(transport, undefined, 'darwin')).toMatchObject({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] });
    expect(toMcpSessionConfig({ ...transport, command: 'C:\\tools\\server.cmd' }, undefined, 'win32')).toMatchObject({ command: 'cmd' });
    expect(toMcpSessionConfig({ ...transport, command: 'C:\\tools\\server.exe' }, undefined, 'win32')).toMatchObject({ command: 'C:\\tools\\server.exe' });
  });

  it('sends a remote server’s token in its header, as a Bearer token for Authorization', () => {
    expect(toMcpSessionConfig({ type: 'http', url: 'https://mcp.example.test/mcp', header: 'Authorization' }, TOKEN)).toEqual({
      type: 'http',
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(toMcpSessionConfig({ type: 'sse', url: 'https://mcp.example.test/sse', header: 'X-API-Key' }, TOKEN)).toEqual({
      type: 'sse',
      url: 'https://mcp.example.test/sse',
      headers: { 'X-API-Key': TOKEN },
    });
    expect(mcpHeaderValue('authorization', TOKEN)).toBe(`Bearer ${TOKEN}`);
  });

  it('names servers uniquely', () => {
    expect(uniqueSessionName('github', new Set(['agent_lanes']))).toBe('github');
    expect(uniqueSessionName('azure-devops', new Set(['azure-devops', 'azure-devops-2']))).toBe('azure-devops-3');
  });
});

describe('built-in Azure DevOps MCP server', () => {
  it('runs the official server for a dev.azure.com organisation with PAT authentication', () => {
    expect(adoMcpServerFor('https://dev.azure.com/CompanionSystems')).toEqual({
      name: 'Azure DevOps (CompanionSystems)',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@azure-devops/mcp', 'CompanionSystems', '--authentication', 'pat'],
        envVar: 'PERSONAL_ACCESS_TOKEN',
      },
      tokenFromPat: adoMcpCredential,
    });
  });

  it('takes the organisation from a visualstudio.com host', () => {
    expect(adoMcpServerFor('https://contoso.visualstudio.com')?.transport.args).toEqual(['-y', '@azure-devops/mcp', 'contoso', '--authentication', 'pat']);
    expect(adoMcpServerFor('https://contoso.visualstudio.com/DefaultCollection')?.name).toBe('Azure DevOps (contoso)');
  });

  it('gives Azure DevOps Server collections and loopback fakes none', () => {
    expect(adoMcpServerFor('https://tfs.example.com/tfs/DefaultCollection')).toBeUndefined();
    expect(adoMcpServerFor('http://127.0.0.1:8080/CompanionSystems')).toBeUndefined();
    expect(adoMcpServerFor('not a url')).toBeUndefined();
  });

  it('passes the PAT as the base64 Basic credential the server sends', () => {
    expect(adoMcpCredential(PAT)).toBe(Buffer.from(`:${PAT}`).toString('base64'));
    const server = adoMcpServerFor('https://dev.azure.com/CompanionSystems');
    if (!server) throw new Error('expected a built-in server');
    expect(toMcpSessionConfig(server.transport, server.tokenFromPat(PAT), 'win32')).toEqual({
      type: 'stdio',
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@azure-devops/mcp', 'CompanionSystems', '--authentication', 'pat'],
      env: { PERSONAL_ACCESS_TOKEN: Buffer.from(`:${PAT}`).toString('base64') },
    });
  });
});
