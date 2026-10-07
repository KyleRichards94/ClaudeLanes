import { describe, expect, it } from 'vitest';
import { eventContracts, invokeContracts } from '../schemas';
import {
  ConnectionDraftSchema,
  ConnectionIdSchema,
  ConnectionSummarySchema,
  MASKED_TOKEN_BULLETS,
  MaskedTokenSchema,
  TestConnectionRequestSchema,
  type ConnectionSummary,
} from './connections.schemas';

/** Shaped like a real 52-character PAT; valid nowhere. */
const FAKE_PAT = 'fakepat7q2w9e4r1t6y3u8i5o0p2a7s4d9f1g6h3j8k5l0z27Fq2';

const adoRow: ConnectionSummary = {
  kind: 'ado',
  id: 'ado:companionsystems',
  name: 'CompanionSystems',
  orgUrl: 'https://dev.azure.com/CompanionSystems',
  defaultProject: 'OnSite Companion',
  identity: 'Kyle Richards',
  maskedToken: `${MASKED_TOKEN_BULLETS}7Fq2`,
  expiresAt: '2027-01-12',
  status: 'ok',
  statusMessage: null,
  needsReconnect: false,
  missingScopes: [],
  lastTestedAt: '2026-10-07T03:00:00.000Z',
  createdAt: '2026-10-07T03:00:00.000Z',
  updatedAt: '2026-10-07T03:00:00.000Z',
};

describe('connections contracts (AL-042)', () => {
  describe('masked token', () => {
    it('is eight bullets and at most the last four characters', () => {
      expect(MaskedTokenSchema.safeParse('••••••••7Fq2').success).toBe(true);
      expect(MaskedTokenSchema.safeParse('••••••••').success).toBe(true);
      expect(MaskedTokenSchema.safeParse('••••••••47Fq2').success).toBe(false);
      expect(MaskedTokenSchema.safeParse('•••7Fq2').success).toBe(false);
    });

    it('cannot hold a full token', () => {
      expect(MaskedTokenSchema.safeParse(FAKE_PAT).success).toBe(false);
      expect(MaskedTokenSchema.safeParse(`${MASKED_TOKEN_BULLETS}${FAKE_PAT}`).success).toBe(false);
      expect(ConnectionSummarySchema.safeParse({ ...adoRow, maskedToken: FAKE_PAT }).success).toBe(false);
    });
  });

  it('a row sent with a token field by mistake loses the field before it crosses IPC', () => {
    const leaky = { ...adoRow, pat: FAKE_PAT, secretId: 'ado:companionsystems' };
    const parsed = invokeContracts['connections:save'].response.parse(leaky);
    expect(JSON.stringify(parsed)).not.toContain(FAKE_PAT);
    expect(parsed).toEqual(adoRow);
  });

  it('connections:changed carries no token either', () => {
    const parsed = eventContracts['connections:changed'].parse({ at: 1, apiKey: FAKE_PAT });
    expect(parsed).toEqual({ at: 1 });
  });

  it('list responses are status rows', () => {
    const list = invokeContracts['connections:list'].response.parse([adoRow]);
    expect(list).toEqual([adoRow]);
  });

  describe('ids', () => {
    it.each(['ado:contoso', 'ado:companionsystems-2', 'mcp:github', 'mcp:ado.contoso', 'claude'])('accepts %s', (id) => {
      expect(ConnectionIdSchema.safeParse(id).success).toBe(true);
    });

    it.each(['', 'ado:', 'ado:Contoso', 'claude:api-key', 'secrets', 'mcp:../x', 'ado:__proto__'])('refuses %s', (id) => {
      expect(ConnectionIdSchema.safeParse(id).success).toBe(false);
    });
  });

  describe('drafts', () => {
    it('trims what was typed and refuses tokens with spaces', () => {
      const parsed = ConnectionDraftSchema.parse({ kind: 'ado', orgUrl: ' https://dev.azure.com/contoso/ ', pat: `  ${FAKE_PAT}\n` });
      expect(parsed).toMatchObject({ orgUrl: 'https://dev.azure.com/contoso/', pat: FAKE_PAT });
      expect(ConnectionDraftSchema.safeParse({ kind: 'ado', orgUrl: 'https://dev.azure.com/contoso', pat: 'two words' }).success).toBe(false);
      expect(ConnectionDraftSchema.safeParse({ kind: 'ado', orgUrl: 'https://dev.azure.com/contoso', pat: '   ' }).success).toBe(false);
    });

    it('refuses unknown keys, so nothing unexpected rides along with a token', () => {
      expect(ConnectionDraftSchema.safeParse({ kind: 'ado', orgUrl: 'https://dev.azure.com/contoso', pat: FAKE_PAT, extra: 1 }).success).toBe(false);
    });

    it('takes an API key with mode api-key only', () => {
      expect(ConnectionDraftSchema.safeParse({ kind: 'claude', mode: 'login' }).success).toBe(true);
      expect(ConnectionDraftSchema.safeParse({ kind: 'claude', mode: 'api-key', apiKey: 'sk-ant-fake-key-0000' }).success).toBe(true);
      expect(ConnectionDraftSchema.safeParse({ kind: 'claude', mode: 'api-key' }).success).toBe(false);
      expect(ConnectionDraftSchema.safeParse({ kind: 'claude', mode: 'login', apiKey: 'sk-ant-fake-key-0000' }).success).toBe(false);
    });

    it('needs to know where an MCP token goes', () => {
      const stdio = { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVar: null };
      expect(ConnectionDraftSchema.safeParse({ kind: 'mcp', name: 'GitHub', transport: stdio }).success).toBe(true);
      expect(ConnectionDraftSchema.safeParse({ kind: 'mcp', name: 'GitHub', transport: stdio, token: 'ghp_fake' }).success).toBe(false);
      expect(
        ConnectionDraftSchema.safeParse({ kind: 'mcp', name: 'GitHub', transport: { ...stdio, envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' }, token: 'ghp_fake' })
          .success,
      ).toBe(true);
      const http = { type: 'http', url: 'https://mcp.example.test/mcp', header: 'Authorization' };
      expect(ConnectionDraftSchema.safeParse({ kind: 'mcp', name: 'Docs', transport: http, token: 'fake' }).success).toBe(true);
      expect(ConnectionDraftSchema.safeParse({ kind: 'mcp', name: 'Docs', transport: { ...http, url: 'ftp://mcp.example.test' } }).success).toBe(false);
    });
  });

  it('tests either a draft or a saved connection', () => {
    expect(TestConnectionRequestSchema.safeParse({ id: 'ado:contoso' }).success).toBe(true);
    expect(TestConnectionRequestSchema.safeParse({ draft: { kind: 'claude', mode: 'login' } }).success).toBe(true);
    expect(TestConnectionRequestSchema.safeParse({ id: 'ado:contoso', draft: { kind: 'claude', mode: 'login' } }).success).toBe(false);
    expect(TestConnectionRequestSchema.safeParse({}).success).toBe(false);
  });
});
