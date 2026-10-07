import { MaskedTokenSchema } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { isConnectionSecretId, maskToken, orgNameFromUrl, parseConnectionsDocument, scrubSecrets, slugify, uniqueId } from './records';

const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';

describe('maskToken', () => {
  it('shows eight bullets and the last four characters, as artboard 5 does', () => {
    expect(maskToken(PAT)).toBe('••••••••7Fq2');
    expect(MaskedTokenSchema.safeParse(maskToken(PAT)).success).toBe(true);
  });

  it('shows bullets only for a short token', () => {
    expect(maskToken('short-token-123')).toBe('••••••••');
  });
});

describe('scrubSecrets', () => {
  it('removes the token, its Basic-auth and base64 forms, and its URL-encoded form', () => {
    const token = 'abc+def/ghi=0000111122223333';
    const text = [token, btoa(`:${token}`), btoa(token), encodeURIComponent(token)].join(' | ');
    const scrubbed = scrubSecrets(text, [token, undefined]);
    expect(scrubbed).toBe('•••••••• | •••••••• | •••••••• | ••••••••');
  });

  it('leaves text without the token alone', () => {
    expect(scrubSecrets('401 Unauthorized', [PAT])).toBe('401 Unauthorized');
  });
});

describe('ids and names', () => {
  it('derives the organisation name from its URL', () => {
    expect(orgNameFromUrl('https://dev.azure.com/CompanionSystems')).toBe('CompanionSystems');
    expect(orgNameFromUrl('https://contoso.visualstudio.com')).toBe('contoso');
    expect(orgNameFromUrl('https://tfs.example.test/tfs/Default%20Collection')).toBe('Default Collection');
    expect(orgNameFromUrl('https://ado.example.test')).toBe('ado.example.test');
  });

  it('makes slugs that fit a connection id', () => {
    expect(slugify('CompanionSystems')).toBe('companionsystems');
    expect(slugify('Default Collection')).toBe('default-collection');
    expect(slugify('__proto__')).toBe('proto');
    expect(slugify('!!!')).toBe('connection');
    expect(slugify('x'.repeat(200))).toHaveLength(56);
  });

  it('numbers an id that is taken', () => {
    expect(uniqueId('ado', 'Contoso', new Set())).toBe('ado:contoso');
    expect(uniqueId('ado', 'Contoso', new Set(['ado:contoso', 'ado:contoso-2']))).toBe('ado:contoso-3');
  });

  it('owns the ado:, claude: and mcp: secret ids only', () => {
    expect(['ado:contoso', 'claude:api-key', 'mcp:github', 'design:canvas', 'adox:y'].filter(isConnectionSecretId)).toEqual([
      'ado:contoso',
      'claude:api-key',
      'mcp:github',
    ]);
  });
});

describe('parseConnectionsDocument', () => {
  const record = {
    kind: 'claude',
    id: 'claude',
    name: 'Claude',
    mode: 'login',
    secretId: null,
    identity: null,
    maskedToken: null,
    expiresAt: null,
    status: 'untested',
    statusMessage: null,
    lastTestedAt: null,
    createdAt: '2026-10-07T03:00:00.000Z',
    updatedAt: '2026-10-07T03:00:00.000Z',
  };

  it('keeps valid records and counts the rest', () => {
    expect(parseConnectionsDocument({ version: 1, connections: [record, { ...record, mode: 'magic' }, record] })).toEqual({
      connections: [record],
      dropped: 2,
      unsupported: false,
    });
  });

  it('does not read a newer version or something else entirely', () => {
    expect(parseConnectionsDocument({ version: 2, connections: [record] })).toMatchObject({ connections: [], unsupported: true });
    expect(parseConnectionsDocument([record])).toMatchObject({ unsupported: true });
  });
});
