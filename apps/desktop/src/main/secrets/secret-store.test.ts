import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRETS_FILE_NAME, SecretStoreError, createSecretStore, type SecretStoreOptions } from './secret-store';
import { createFakeSafeStorage, type FakeSafeStorage } from './testing';

/** Shaped like an ADO PAT (52 chars); made up for the test, never a real credential. */
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';
const API_KEY = 'sk-ant-test-0000-not-a-real-key-0000';

let dir: string;
let filePath: string;
let key: Buffer;
let safeStorage: FakeSafeStorage;
let warnings: string[];

function openStore(overrides: Partial<SecretStoreOptions> = {}) {
  return createSecretStore({ filePath, safeStorage, warn: (line) => warnings.push(line), ...overrides });
}

async function readFileText(): Promise<string> {
  return readFile(filePath, 'utf8');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-secrets-'));
  filePath = join(dir, SECRETS_FILE_NAME);
  key = randomBytes(32);
  safeStorage = createFakeSafeStorage({ key });
  warnings = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SecretStore', () => {
  it('round-trips a secret and survives a restart', async () => {
    const store = openStore();
    await store.put('ado:contoso', PAT);
    await expect(store.get('ado:contoso')).resolves.toBe(PAT);

    // Same machine (same OS key), new process.
    const reopened = openStore({ safeStorage: createFakeSafeStorage({ key }) });
    await expect(reopened.get('ado:contoso')).resolves.toBe(PAT);
  });

  it('writes no plaintext token to disk', async () => {
    const store = openStore();
    await store.put('ado:contoso', PAT);
    await store.put('claude:api-key', API_KEY);

    const bytes = await readFile(filePath);
    const text = bytes.toString('utf8');
    for (const secret of [PAT, API_KEY]) {
      expect(text).not.toContain(secret);
      // Nor trivially encoded forms of it.
      expect(text).not.toContain(Buffer.from(secret).toString('base64'));
      expect(text).not.toContain(Buffer.from(secret).toString('base64url'));
      expect(text).not.toContain(Buffer.from(secret).toString('hex'));
      expect(bytes.includes(Buffer.from(secret, 'utf16le'))).toBe(false);
      // Nor a recognisable tail (the masked "••••7Fq2" form is built in memory, never stored).
      expect(text).not.toContain(secret.slice(-8));
    }

    const file = JSON.parse(text) as { version: number; secrets: Record<string, object> };
    expect(file.version).toBe(1);
    expect(Object.keys(file.secrets)).toEqual(['ado:contoso', 'claude:api-key']);
    expect(Object.keys(file.secrets['ado:contoso'] ?? {}).sort()).toEqual(['ciphertext', 'createdAt', 'updatedAt']);
    expect(safeStorage.encryptCalls).toBe(2);
  });

  it('lists ids and timestamps only, sorted by id', async () => {
    const store = openStore({ now: () => new Date('2026-10-07T01:02:03.000Z') });
    await store.put('mcp:github', 'fake-mcp-token-0000');
    await store.put('ado:contoso', PAT);

    const listed = await store.list();
    expect(listed).toEqual([
      { id: 'ado:contoso', createdAt: '2026-10-07T01:02:03.000Z', updatedAt: '2026-10-07T01:02:03.000Z' },
      { id: 'mcp:github', createdAt: '2026-10-07T01:02:03.000Z', updatedAt: '2026-10-07T01:02:03.000Z' },
    ]);
    expect(JSON.stringify(listed)).not.toContain(PAT);
    expect(safeStorage.decryptCalls).toBe(0);
  });

  it('replaces a secret, keeping createdAt and moving updatedAt', async () => {
    let clock = new Date('2026-10-07T00:00:00.000Z');
    const store = openStore({ now: () => clock });
    await store.put('ado:contoso', PAT);
    clock = new Date('2026-10-08T00:00:00.000Z');
    const replaced = await store.put('ado:contoso', 'fakepat-replacement-0000');

    expect(replaced).toEqual({
      id: 'ado:contoso',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    });
    await expect(store.get('ado:contoso')).resolves.toBe('fakepat-replacement-0000');
    await expect(openStore().get('ado:contoso')).resolves.toBe('fakepat-replacement-0000');
  });

  it('deletes a secret from memory and disk', async () => {
    const store = openStore();
    await store.put('ado:contoso', PAT);
    await store.put('ado:fabrikam', 'fakepat-fabrikam-0000');

    await expect(store.delete('ado:contoso')).resolves.toBe(true);
    await expect(store.delete('ado:contoso')).resolves.toBe(false);
    await expect(store.get('ado:contoso')).resolves.toBeUndefined();

    const file = JSON.parse(await readFileText()) as { secrets: Record<string, unknown> };
    expect(Object.keys(file.secrets)).toEqual(['ado:fabrikam']);
    await expect(openStore().list()).resolves.toMatchObject([{ id: 'ado:fabrikam' }]);
  });

  it('starts empty when there is no file, and creates none until something is saved', async () => {
    const store = openStore();
    await expect(store.get('ado:contoso')).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual([]);
    await expect(store.delete('ado:contoso')).resolves.toBe(false);
    await expect(store.status()).resolves.toEqual({ encryptionAvailable: true, issues: [] });
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('serialises concurrent writes so none is lost', async () => {
    const store = openStore();
    const ids = Array.from({ length: 12 }, (_, index) => `mcp:server-${String(index).padStart(2, '0')}`);
    await Promise.all(ids.map((id, index) => store.put(id, `fake-token-${index}`)));
    await Promise.all([store.delete(ids[0] ?? ''), store.put('ado:contoso', PAT)]);

    const reopened = openStore();
    await expect(reopened.list()).resolves.toHaveLength(12);
    await expect(reopened.get(ids[5] ?? '')).resolves.toBe('fake-token-5');
    await expect(reopened.get(ids[0] ?? '')).resolves.toBeUndefined();
    // Atomic replace: no temp files left behind.
    await expect(readdir(dir)).resolves.toEqual([SECRETS_FILE_NAME]);
  });

  describe('without OS encryption', () => {
    it('refuses to store and writes nothing (no plaintext fallback)', async () => {
      safeStorage.available = false;
      const store = openStore();

      const failure = await store.put('ado:contoso', PAT).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(SecretStoreError);
      expect((failure as SecretStoreError).code).toBe('ENCRYPTION_UNAVAILABLE');
      expect((failure as SecretStoreError).message).not.toContain(PAT);
      await expect(readdir(dir)).resolves.toEqual([]);
      await expect(store.status()).resolves.toMatchObject({ encryptionAvailable: false });
    });

    it('treats the Linux basic_text backend (hard-coded key) as unavailable', async () => {
      safeStorage = createFakeSafeStorage({ key, linuxBackend: 'basic_text' });
      const store = openStore();

      await expect(store.put('ado:contoso', PAT)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
      expect(safeStorage.encryptCalls).toBe(0);
    });

    it('accepts a real Linux keyring backend', async () => {
      safeStorage = createFakeSafeStorage({ key, linuxBackend: 'gnome_libsecret' });
      const store = openStore();
      await store.put('ado:contoso', PAT);
      await expect(store.get('ado:contoso')).resolves.toBe(PAT);
    });

    it('reads saved secrets as missing while encryption is unavailable, without throwing', async () => {
      await openStore().put('ado:contoso', PAT);
      safeStorage.available = false;
      const store = openStore();

      await expect(store.get('ado:contoso')).resolves.toBeUndefined();
      await expect(store.list()).resolves.toHaveLength(1);
    });

    it('reports an encryption failure without the secret', async () => {
      safeStorage.encryptString = () => {
        throw new Error('boom');
      };
      const store = openStore();
      const failure = await store.put('ado:contoso', PAT).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'ENCRYPTION_FAILED' });
      expect(String(failure)).not.toContain(PAT);
    });
  });

  describe('input checks', () => {
    it.each(['', ' ado', '__proto__', 'ado contoso', 'a'.repeat(201), '../secrets', 'ado\ncontoso'])(
      'rejects the id %j',
      async (id) => {
        const store = openStore();
        await expect(store.put(id, PAT)).rejects.toMatchObject({ code: 'INVALID_ID' });
        await expect(store.get(id)).resolves.toBeUndefined();
        await expect(store.delete(id)).resolves.toBe(false);
      },
    );

    it('rejects an empty or oversized secret', async () => {
      const store = openStore();
      await expect(store.put('ado:contoso', '')).rejects.toMatchObject({ code: 'INVALID_SECRET' });
      await expect(store.put('ado:contoso', 'x'.repeat(64 * 1024 + 1))).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    });
  });

  describe('corrupt or unreadable file', () => {
    const corruptFiles: Array<[string, string | Buffer]> = [
      ['not JSON', '{"version":1,"secrets":{"ado:contoso":{"cipher'],
      ['empty', ''],
      ['binary garbage', Buffer.from([0x00, 0xff, 0xfe, 0x7b, 0x22, 0x80, 0x81, 0x0a, 0xc3, 0x28])],
      ['a JSON array', '[1,2,3]'],
      ['missing secrets', '{"version":1}'],
      ['secrets of the wrong type', '{"version":1,"secrets":"oops"}'],
    ];

    it.each(corruptFiles)('treats %s as no secrets, sets it aside and keeps working', async (_label, contents) => {
      await writeFile(filePath, contents);
      const store = openStore({ now: () => new Date('2026-10-07T09:30:00.000Z') });

      await expect(store.get('ado:contoso')).resolves.toBeUndefined();
      await expect(store.list()).resolves.toEqual([]);
      await expect(store.delete('ado:contoso')).resolves.toBe(false);

      const backupPath = join(dir, 'secrets.corrupt-2026-10-07T09-30-00-000Z.json');
      await expect(store.status()).resolves.toEqual({
        encryptionAvailable: true,
        issues: [{ kind: 'file-unreadable', reason: 'corrupt', backupPath }],
      });
      // The broken file is kept for diagnosis, byte for byte.
      expect(await readFile(backupPath)).toEqual(Buffer.from(contents));
      expect(warnings.join('\n')).toContain('treated as missing');

      // Reconnecting works: the next save writes a fresh, valid file.
      await store.put('ado:contoso', PAT);
      await expect(openStore().get('ado:contoso')).resolves.toBe(PAT);
    });

    it('treats a file from a newer version as unreadable instead of guessing its format', async () => {
      await writeFile(filePath, JSON.stringify({ version: 2, secrets: {} }));
      const store = openStore();
      await expect(store.status()).resolves.toMatchObject({
        issues: [{ kind: 'file-unreadable', reason: 'unsupported-version' }],
      });
      await expect(store.list()).resolves.toEqual([]);
    });

    it('drops only the malformed entries and keeps the rest', async () => {
      const store = openStore();
      await store.put('ado:contoso', PAT);
      const file = JSON.parse(await readFileText()) as { secrets: Record<string, unknown> };
      file.secrets['ado:fabrikam'] = { ciphertext: 42 };
      file.secrets['mcp:github'] = { ciphertext: 'not base64!', createdAt: 'yesterday', updatedAt: 'today' };
      await writeFile(filePath, JSON.stringify(file));

      const reopened = openStore();
      await expect(reopened.get('ado:contoso')).resolves.toBe(PAT);
      await expect(reopened.get('ado:fabrikam')).resolves.toBeUndefined();
      await expect(reopened.list()).resolves.toMatchObject([{ id: 'ado:contoso' }]);
      await expect(reopened.status()).resolves.toEqual({
        encryptionAvailable: true,
        issues: [
          { kind: 'entry-invalid', id: 'ado:fabrikam' },
          { kind: 'entry-invalid', id: 'mcp:github' },
        ],
      });

      // Replacing a dropped secret clears its issue.
      await reopened.put('ado:fabrikam', 'fakepat-fabrikam-0000');
      await expect(reopened.status()).resolves.toMatchObject({ issues: [{ kind: 'entry-invalid', id: 'mcp:github' }] });
    });

    it('ignores prototype keys in the file', async () => {
      await writeFile(filePath, '{"version":1,"secrets":{"__proto__":{"polluted":true}}}');
      const store = openStore();
      await expect(store.list()).resolves.toEqual([]);
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('treats a secret saved under another machine or profile key as missing', async () => {
      await openStore().put('ado:contoso', PAT);
      // A different OS key, e.g. the profile folder was copied to another PC.
      const store = openStore({ safeStorage: createFakeSafeStorage() });

      await expect(store.get('ado:contoso')).resolves.toBeUndefined();
      await expect(store.get('ado:contoso')).resolves.toBeUndefined();
      await expect(store.status()).resolves.toEqual({
        encryptionAvailable: true,
        issues: [{ kind: 'entry-undecryptable', id: 'ado:contoso' }],
      });
      expect(warnings).toHaveLength(1);

      await store.put('ado:contoso', 'fakepat-reconnected-0000');
      await expect(store.get('ado:contoso')).resolves.toBe('fakepat-reconnected-0000');
      await expect(store.status()).resolves.toEqual({ encryptionAvailable: true, issues: [] });
    });

    it('treats tampered ciphertext as missing', async () => {
      await openStore().put('ado:contoso', PAT);
      const file = JSON.parse(await readFileText()) as { secrets: Record<string, { ciphertext: string }> };
      const entry = file.secrets['ado:contoso'];
      if (!entry) throw new Error('entry missing');
      const bytes = Buffer.from(entry.ciphertext, 'base64');
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      entry.ciphertext = bytes.toString('base64');
      await writeFile(filePath, JSON.stringify(file));

      await expect(openStore().get('ado:contoso')).resolves.toBeUndefined();
    });

    it('refuses to overwrite a file it cannot read, and reports it', async () => {
      // A directory where the file should be: reading fails with EISDIR, not ENOENT.
      await rm(filePath, { force: true });
      await mkdir(filePath);
      const store = openStore();

      await expect(store.get('ado:contoso')).resolves.toBeUndefined();
      await expect(store.list()).resolves.toEqual([]);
      await expect(store.status()).resolves.toMatchObject({
        issues: [{ kind: 'file-unreadable', reason: 'io-error', backupPath: null }],
      });
      await expect(store.put('ado:contoso', PAT)).rejects.toMatchObject({ code: 'STORE_UNREADABLE' });
    });

    it('never logs a secret or its ciphertext', async () => {
      await openStore().put('ado:contoso', PAT);
      const ciphertext = (JSON.parse(await readFileText()) as { secrets: Record<string, { ciphertext: string }> })
        .secrets['ado:contoso']?.ciphertext;
      const store = openStore({ safeStorage: createFakeSafeStorage() });
      await store.get('ado:contoso');
      await writeFile(filePath, 'garbage');
      await openStore().status();

      const logged = warnings.join('\n');
      expect(warnings.length).toBeGreaterThanOrEqual(2);
      expect(ciphertext).toBeTruthy();
      expect(logged).not.toContain(PAT);
      expect(logged).not.toContain(ciphertext ?? PAT);
    });
  });
});
