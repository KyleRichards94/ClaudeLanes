import { describe, expect, it } from 'vitest';
import { invokeContracts } from '../schemas';
import { ConnectionSummarySchema, MASKED_TOKEN_BULLETS, MCP_TOOLS_LIMIT, type McpConnectionSummary } from './connections.schemas';

const builtInRow: McpConnectionSummary = {
  kind: 'mcp',
  id: 'mcp:ado.companionsystems',
  name: 'Azure DevOps (CompanionSystems)',
  builtInFor: 'ado:companionsystems',
  transport: { type: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'CompanionSystems', '--authentication', 'pat'], envVar: 'PERSONAL_ACCESS_TOKEN' },
  tools: ['wit_get_work_item', 'wit_add_work_item_comment'],
  identity: 'Azure DevOps MCP Server 2.2.0',
  maskedToken: `${MASKED_TOKEN_BULLETS}7Fq2`,
  expiresAt: null,
  status: 'ok',
  statusMessage: null,
  needsReconnect: false,
  lastTestedAt: '2026-10-07T03:00:00.000Z',
  createdAt: '2026-10-07T03:00:00.000Z',
  updatedAt: '2026-10-07T03:00:00.000Z',
};

describe('MCP server entries (AL-045)', () => {
  it('rows may name the tools the last test listed and the organisation a built-in server comes with', () => {
    expect(invokeContracts['connections:list'].response.parse([builtInRow])).toEqual([builtInRow]);
    const { tools: _tools, builtInFor: _builtInFor, ...userRow } = builtInRow;
    expect(ConnectionSummarySchema.parse(userRow)).toEqual(userRow);
  });

  it('a built-in server points at a connection id', () => {
    expect(ConnectionSummarySchema.safeParse({ ...builtInRow, builtInFor: 'CompanionSystems' }).success).toBe(false);
  });

  it('tool lists are bounded', () => {
    expect(ConnectionSummarySchema.safeParse({ ...builtInRow, tools: Array.from({ length: MCP_TOOLS_LIMIT + 1 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(ConnectionSummarySchema.safeParse({ ...builtInRow, tools: ['x'.repeat(129)] }).success).toBe(false);
    expect(ConnectionSummarySchema.safeParse({ ...builtInRow, tools: [''] }).success).toBe(false);
  });

  it('a test result carries the tools for an MCP server', () => {
    const result = { status: 'ok', identity: 'fake-mcp 1.2.3', message: null, missingScopes: [], scopes: [], projects: null, testedAt: '2026-10-07T03:00:00.000Z', tools: ['echo'] };
    expect(invokeContracts['connections:test'].response.parse(result)).toEqual(result);
  });
});
