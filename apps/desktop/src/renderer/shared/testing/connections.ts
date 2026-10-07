import type {
  AdoConnectionSummary,
  ClaudeConnectionSummary,
  ClaudeLoginDetection,
  ConnectionSummary,
  ConnectionTestResult,
  InvokeChannel,
  McpConnectionSummary,
} from '@agent-lanes/contracts';
import { vi } from 'vitest';
import type { FakeBridge } from './bridge';

const at = '2026-10-07T03:00:00.000Z';

/** A saved Azure DevOps row as `connections:list` returns it (artboard 5's CompanionSystems by default). */
export function fakeAdoRow(overrides: Partial<AdoConnectionSummary> = {}): AdoConnectionSummary {
  return {
    kind: 'ado',
    id: 'ado:companionsystems',
    name: 'CompanionSystems',
    orgUrl: 'https://dev.azure.com/CompanionSystems',
    defaultProject: 'OnSite Companion',
    identity: 'Kyle Richards',
    maskedToken: '••••••••7Fq2',
    expiresAt: null,
    status: 'ok',
    statusMessage: null,
    needsReconnect: false,
    missingScopes: [],
    lastTestedAt: at,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

/** A saved Claude row (the Claude Code login by default). */
export function fakeClaudeRow(overrides: Partial<ClaudeConnectionSummary> = {}): ClaudeConnectionSummary {
  return {
    kind: 'claude',
    id: 'claude',
    name: 'Claude',
    mode: 'login',
    identity: 'kyle@example.test (Companion Systems)',
    maskedToken: null,
    expiresAt: null,
    status: 'ok',
    statusMessage: null,
    needsReconnect: false,
    lastTestedAt: at,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

/** A saved MCP server row (a stdio server with two tools by default). */
export function fakeMcpRow(overrides: Partial<McpConnectionSummary> = {}): McpConnectionSummary {
  return {
    kind: 'mcp',
    id: 'mcp:github',
    name: 'github',
    transport: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVar: 'GITHUB_TOKEN' },
    tools: ['search_issues', 'create_issue'],
    identity: null,
    maskedToken: '••••••••ab12',
    expiresAt: null,
    status: 'ok',
    statusMessage: null,
    needsReconnect: false,
    lastTestedAt: at,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

/** A passing test result; pass `scopes`/`projects` for an ADO one. */
export function fakeTestResult(overrides: Partial<ConnectionTestResult> = {}): ConnectionTestResult {
  return { status: 'ok', identity: null, message: null, missingScopes: [], scopes: [], projects: null, testedAt: at, ...overrides };
}

export interface FakeConnections {
  /** The saved rows the fake main process holds now. */
  rows: ConnectionSummary[];
  /** Every request the renderer sent on a `connections:*` channel, in order (tokens included: tests only). */
  readonly calls: Array<{ channel: InvokeChannel; payload: unknown }>;
  /** Decides each `connections:test` of a draft. Default: passes, signed in as Kyle Richards. */
  testDraft: (draft: Record<string, unknown>) => ConnectionTestResult;
  detection: ClaudeLoginDetection;
}

/**
 * Makes a fake bridge (`installFakeBridge`) answer the `connections:*` channels like the main process:
 * list, test, save (a draft becomes a row with a masked token), replace, remove and detectClaude.
 * Other channels keep the bridge's replies.
 */
export function fakeConnections(bridge: FakeBridge, rows: ConnectionSummary[] = []): FakeConnections {
  const state: FakeConnections = {
    rows: [...rows],
    calls: [],
    testDraft: (draft) =>
      fakeTestResult(
        draft['kind'] === 'ado'
          ? {
              identity: 'Kyle Richards',
              projects: ['OnSite Companion', 'Hicora'],
              scopes: [
                { scope: 'work-items', access: 'read', status: 'granted' },
                { scope: 'work-items', access: 'write', status: 'unverified' },
                { scope: 'code', access: 'read', status: 'granted' },
                { scope: 'code', access: 'write', status: 'unverified' },
                { scope: 'build', access: 'read', status: 'granted' },
              ],
            }
          : draft['kind'] === 'claude'
            ? { identity: 'kyle@example.test (Companion Systems)' }
            : { tools: ['echo'] },
      ),
    detection: {
      found: true,
      identity: 'kyle@example.test (Companion Systems)',
      email: 'kyle@example.test',
      organization: 'Companion Systems',
      plan: 'team',
      provider: 'Anthropic',
      message: null,
      checkedAt: at,
    },
  };

  function rowFromDraft(draft: Record<string, unknown>, id?: string): ConnectionSummary {
    const token = (draft['pat'] ?? draft['apiKey'] ?? draft['token']) as string | undefined;
    const masked = token ? `••••••••${token.slice(-4)}` : null;
    if (draft['kind'] === 'ado') {
      const orgUrl = String(draft['orgUrl']).replace(/\/+$/, '');
      const name = orgUrl.split('/').pop() ?? 'org';
      return fakeAdoRow({
        id: (id ?? `ado:${name.toLowerCase()}`) as AdoConnectionSummary['id'],
        name,
        orgUrl,
        maskedToken: masked,
        defaultProject: (draft['defaultProject'] as string | null | undefined) ?? null,
        expiresAt: (draft['expiresAt'] as string | null | undefined) ?? null,
      });
    }
    if (draft['kind'] === 'claude') return fakeClaudeRow({ mode: draft['mode'] as 'login' | 'api-key', maskedToken: masked });
    const name = String(draft['name']);
    return fakeMcpRow({ id: (id ?? `mcp:${name.toLowerCase()}`) as McpConnectionSummary['id'], name, transport: draft['transport'] as McpConnectionSummary['transport'], maskedToken: masked });
  }

  const others = bridge.invoke;
  bridge.invoke = vi.fn(async (channel: InvokeChannel, payload?: unknown) => {
    if (!channel.startsWith('connections:')) return others(channel, payload);
    state.calls.push({ channel, payload });
    const body = (payload ?? {}) as Record<string, unknown>;
    switch (channel) {
      case 'connections:list':
        return { ok: true, data: structuredClone(state.rows) };
      case 'connections:test':
        if ('id' in body) return { ok: true, data: fakeTestResult() };
        return { ok: true, data: state.testDraft(body['draft'] as Record<string, unknown>) };
      case 'connections:save': {
        const row = rowFromDraft(body);
        state.rows = [...state.rows.filter((existing) => existing.id !== row.id), row];
        return { ok: true, data: row };
      }
      case 'connections:replace': {
        const row = rowFromDraft(body['draft'] as Record<string, unknown>, body['id'] as string);
        state.rows = state.rows.map((existing) => (existing.id === row.id ? row : existing));
        return { ok: true, data: row };
      }
      case 'connections:remove': {
        const removed = state.rows.some((row) => row.id === body['id']);
        state.rows = state.rows.filter((row) => row.id !== body['id']);
        return { ok: true, data: { id: body['id'], removed } };
      }
      case 'connections:detectClaude':
        return { ok: true, data: state.detection };
      default:
        return { ok: false, code: 'INTERNAL', message: `no fake for ${channel}` };
    }
  });
  return state;
}
