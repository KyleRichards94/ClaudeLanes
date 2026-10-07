import { describe, expect, it } from 'vitest';
import { REDACTED, createRedactor, isSecretName } from './redact';

/** Made up for the tests; never real credentials. */
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';
const CLASSIC_ADO_PAT = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst';
const NEW_ADO_PAT = `${'A1b2C3d4'.repeat(9)}Xy9ZAZDOq7W2`;
const ANTHROPIC_KEY = 'sk-ant-api03-fakeKEYfor-tests-only_0000';
const GITHUB_TOKEN = `ghp_${'F4k3'.repeat(9)}`;
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.c2lnbmF0dXJlLWZvci10ZXN0cw';

describe('isSecretName', () => {
  it.each(['token', 'accessToken', 'refresh_token', 'pat', 'adoPat', 'AZURE_DEVOPS_EXT_PAT', 'apiKey', 'x-api-key', 'ANTHROPIC_API_KEY', 'clientSecret', 'password', 'Authorization', 'cookie', 'set-cookie', 'credentials', 'privateKey', 'auth'])(
    'flags %s',
    (name) => {
      expect(isSecretName(name)).toBe(true);
    },
  );

  it.each(['path', 'worktreePath', 'patch', 'pattern', 'inputTokens', 'outputTokens', 'maskedToken', 'maskedPat', 'keyboard', 'author', 'id', 'key', 'PWD'])(
    'allows %s',
    (name) => {
      expect(isSecretName(name)).toBe(false);
    },
  );
});

describe('redactText', () => {
  it('removes a registered secret and the encoded forms it travels in', () => {
    const redactor = createRedactor();
    redactor.addSecret(PAT);
    const basic = Buffer.from(`:${PAT}`).toString('base64');
    const text = [
      `pat ${PAT} again ${PAT}`,
      `base64 ${Buffer.from(PAT).toString('base64')}`,
      `basic ${basic}`,
      `url-encoded ${encodeURIComponent(`${PAT}/+`).slice(0, -6)}`,
      `base64url ${Buffer.from(PAT).toString('base64url')}`,
    ].join('\n');

    const out = redactor.redactText(text);
    expect(out).not.toContain(PAT);
    expect(out).not.toContain(basic);
    expect(out).not.toContain(Buffer.from(PAT).toString('base64'));
    expect(out.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('ignores values too short to redact safely', () => {
    const redactor = createRedactor();
    redactor.addSecret('abc');
    redactor.addSecret('');
    redactor.addSecret(undefined);
    expect(redactor.redactText('abc abc')).toBe('abc abc');
  });

  it('registers secret-looking environment variables, not the rest', () => {
    const redactor = createRedactor({
      env: {
        AZURE_DEVOPS_EXT_PAT: PAT,
        ANTHROPIC_API_KEY: ANTHROPIC_KEY,
        PATH: 'C:\\Windows\\System32',
        HOME: 'C:\\Users\\someone',
        // Secret-sounding names whose values are not secrets: paths and plain words.
        PWD: 'C:/Users/someone/repos/app',
        GOOGLE_APPLICATION_CREDENTIALS: 'C:\\keys\\service-account.json',
        SSH_AUTH_SOCK: '/tmp/ssh-XXXXabcd/agent.1234',
        AUTH_TYPE: 'interactive',
      },
    });
    expect(redactor.redactText(`${PAT} C:\\Windows\\System32`)).toBe(`${REDACTED} C:\\Windows\\System32`);
    const ordinary = 'file:///C:/Users/someone/repos/app/out/index.js C:\\keys\\service-account.json /tmp/ssh-XXXXabcd/agent.1234 interactive';
    expect(redactor.redactText(ordinary)).toBe(ordinary);
  });

  it.each([
    ['an Authorization header', `Authorization: Basic ${Buffer.from(':whatever-token-value').toString('base64')}`, 'Authorization: Basic [REDACTED]'],
    ['a JSON authorization field', `{"authorization":"Bearer abc.def.ghi"}`, '{"authorization":"Bearer [REDACTED]"}'],
    ['an x-api-key header', 'x-api-key: some-key-value', 'x-api-key: [REDACTED]'],
    ['a cookie header', 'Cookie: session=abc; other=def', 'Cookie: [REDACTED]'],
    ['a bare bearer token', 'sent Bearer abcdefghijklmnopqrstuvwxyz0123 to ADO', 'sent Bearer [REDACTED] to ADO'],
    ['a URL with a user and password', 'git fetch https://kyle:hunter2hunter2@dev.azure.com/org/_git/repo', 'git fetch https://[REDACTED]@dev.azure.com/org/_git/repo'],
    ['a URL with a PAT as the user', `https://${PAT}@dev.azure.com/org`, 'https://[REDACTED]@dev.azure.com/org'],
    ['a query parameter', 'GET /x?api-version=7.1&access_token=abc123&top=5', 'GET /x?api-version=7.1&access_token=[REDACTED]&top=5'],
    ['an env assignment', 'ANTHROPIC_API_KEY=whatever123 node app.js', 'ANTHROPIC_API_KEY=[REDACTED] node app.js'],
    ['a quoted JSON value', '{"pat": "two words"}', '{"pat": "[REDACTED]"}'],
    ['a password', "password='p@ss w0rd'", "password='[REDACTED]'"],
    ['an Anthropic key', `key is ${ANTHROPIC_KEY}.`, `key is ${REDACTED}.`],
    ['a GitHub token', `token ${GITHUB_TOKEN}`, `token ${REDACTED}`],
    ['a JWT', `got ${JWT}`, `got ${REDACTED}`],
    ['a classic ADO PAT', `used ${CLASSIC_ADO_PAT} for org`, `used ${REDACTED} for org`],
    ['a new-format ADO PAT', `used ${NEW_ADO_PAT}`, `used ${REDACTED}`],
  ])('redacts %s', (_label, input, expected) => {
    const redactor = createRedactor();
    expect(redactor.redactText(input)).toBe(expected);
    // Idempotent: a second pass changes nothing.
    expect(redactor.redactText(expected)).toBe(expected);
  });

  it.each([
    'Basic settings saved for org contoso',
    'Missing authorization header',
    'inputTokens: 1200, outputTokens: 300',
    'path=C:\\repo\\src pattern=*.ts',
    'commit 3f9c2a1b7d5e4f6a8b9c0d1e2f3a4b5c6d7e8f90 on main',
    'git@ssh.dev.azure.com:v3/org/project/repo',
    'id 1f0e1c5a-5d1b-4f2e-9a33-3d6f0e7b8c21',
  ])('leaves ordinary text alone: %s', (text) => {
    expect(createRedactor().redactText(text)).toBe(text);
  });
});

describe('redactValue', () => {
  it('drops values of secret-named fields at any depth and keeps the shape', () => {
    const redactor = createRedactor();
    const out = redactor.redactValue({
      org: 'contoso',
      pat: PAT,
      nested: { headers: { Authorization: `Basic xyz`, Accept: 'application/json' }, list: [{ apiKey: 'k-123456789' }] },
      hasToken: true,
      maskedToken: '••••7Fq2',
      inputTokens: 42,
    });
    expect(out).toEqual({
      org: 'contoso',
      pat: REDACTED,
      nested: { headers: { Authorization: REDACTED, Accept: 'application/json' }, list: [{ apiKey: REDACTED }] },
      hasToken: true,
      maskedToken: '••••7Fq2',
      inputTokens: 42,
    });
  });

  it('keeps environment variable names and drops every value', () => {
    const out = createRedactor().redactValue({
      command: 'claude',
      env: { PATH: 'C:\\bin', AZURE_DEVOPS_EXT_PAT: PAT },
      childEnv: ['HOME=C:\\Users\\x', `GITHUB_TOKEN=${GITHUB_TOKEN}`],
    });
    expect(out).toEqual({
      command: 'claude',
      env: { PATH: REDACTED, AZURE_DEVOPS_EXT_PAT: REDACTED },
      childEnv: [`HOME=${REDACTED}`, `GITHUB_TOKEN=${REDACTED}`],
    });
  });

  it('redacts strings inside values, errors, maps and headers', () => {
    const redactor = createRedactor();
    redactor.addSecret(PAT);
    const error = Object.assign(new Error(`request with ${PAT} failed`), { code: 'E401', config: { headers: { authorization: 'Basic abc' } } });
    const out = redactor.redactValue({
      error,
      map: new Map([['note', `pat is ${PAT}`]]),
      headers: new Headers({ authorization: `Bearer ${PAT}`, accept: 'json' }),
      url: new URL(`https://user:${PAT}@dev.azure.com/org`),
    }) as Record<string, Record<string, unknown>>;

    expect(JSON.stringify(out)).not.toContain(PAT);
    expect(out['error']?.['message']).toBe(`request with ${REDACTED} failed`);
    expect(out['error']?.['code']).toBe('E401');
    expect(out['error']?.['config']).toEqual({ headers: { authorization: REDACTED } });
    expect(out['map']).toEqual({ note: `pat is ${REDACTED}` });
    expect(out['headers']).toEqual({ accept: 'json', authorization: REDACTED });
    expect(out['url']).toBe(`https://${REDACTED}@dev.azure.com/org`);
  });

  it('copes with cycles, depth, binary data and odd types', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i += 1) deep = { deep };

    const out = createRedactor().redactValue({
      cyclic,
      deep,
      buffer: Buffer.from('ciphertext bytes'),
      big: 10n,
      fn: function namedFunction() {},
      when: new Date('2026-10-07T00:00:00.000Z'),
    }) as Record<string, unknown>;

    expect(out['cyclic']).toEqual({ name: 'loop', self: '[Circular]' });
    expect(JSON.stringify(out['deep'])).toContain('[Object]');
    expect(out['buffer']).toBe('[Binary 16 bytes]');
    expect(out['big']).toBe('10');
    expect(out['fn']).toBe('[Function namedFunction]');
    expect(out['when']).toBe('2026-10-07T00:00:00.000Z');
  });
});
