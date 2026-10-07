import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/** AL-040: a corrupt secrets file means "reconnect", never a crash. */
test.describe('secret store', () => {
  let app: ElectronApplication;
  let userDataDir: string;
  const garbage = '{"version":1,"secrets":{"ado:contoso":{"ciphertext":';

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-secrets-'));
    writeFileSync(join(userDataDir, 'secrets.json'), garbage);
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('starts normally with a corrupt secrets.json and sets the file aside', async () => {
    const page = await app.firstWindow();
    await expect(page.getByText('Agent board')).toBeVisible();

    await expect.poll(() => existsSync(join(userDataDir, 'secrets.json'))).toBe(false);
    const backups = readdirSync(userDataDir).filter((name) => /^secrets\.corrupt-.+\.json$/.test(name));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(userDataDir, backups[0] ?? ''), 'utf8')).toBe(garbage);
  });
});
