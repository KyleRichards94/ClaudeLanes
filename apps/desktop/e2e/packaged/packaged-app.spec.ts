import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { resolveClaudeExecutable, toUnpackedPath } from '../../src/main/agent/claude-executable';
import { appPackage, claudeCodeVersion, installerPath, powershell, unpackedExe } from './release';

/**
 * Checks the `pnpm package` output (ticket AL-007): installer name, the packaged app itself
 * (release/<version>/win-unpacked, the same files the installer lays down), version stamping, and
 * the Agent SDK's native binary outside app.asar. Run with `pnpm e2e:packaged`.
 */

test.skip(process.platform !== 'win32', 'The Windows installer is the only package target so far.');
test.skip(!existsSync(unpackedExe), `No packaged app at ${unpackedExe}; run \`pnpm package\` first.`);

let app: ElectronApplication;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-packaged-'));
  app = await electron.launch({
    executablePath: unpackedExe,
    args: [],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('pnpm package names the installer release/<version>/Agent Lanes-<version>-setup.exe', () => {
  expect(existsSync(installerPath), installerPath).toBe(true);
});

test('the packaged app launches and shows the board', async () => {
  const page = await app.firstWindow();

  await expect(page).toHaveTitle('Agent Lanes');
  await expect(page.getByText('Agent board')).toBeVisible();
  await expect(page.getByTestId('runtime-info')).toContainText(`v${appPackage.version} · Electron`);
  expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true);

  await page.screenshot({ path: join(__dirname, '..', '..', 'test-results', 'packaged-board.png') });
});

test('stamps the package.json version and product name into the exe', () => {
  const info = JSON.parse(
    powershell(
      `(Get-Item -LiteralPath '${unpackedExe}').VersionInfo | Select-Object ProductName, ProductVersion, FileVersion | ConvertTo-Json`,
    ),
  ) as { ProductName: string; ProductVersion: string; FileVersion: string };

  expect(info.ProductName).toBe(appPackage.productName);
  expect(info.ProductVersion).toBe(appPackage.version);
  expect(info.FileVersion.startsWith(appPackage.version)).toBe(true);
});

test('finds the Agent SDK claude binary in app.asar.unpacked and it runs', async () => {
  const resourcesPath = await app.evaluate(() => process.resourcesPath);

  const claude = resolveClaudeExecutable({
    platform: process.platform,
    arch: process.arch,
    isPackaged: true,
    resourcesPath,
    resolve: () => {
      throw new Error('not used when packaged');
    },
    exists: existsSync,
  });

  expect(claude).not.toBeNull();
  expect(claude).toContain(`${sep}app.asar.unpacked${sep}`);
  expect(execFileSync(claude ?? '', ['--version'], { encoding: 'utf8', windowsHide: true })).toContain(claudeCodeVersion);
});

test("the SDK's own lookup points inside app.asar, which is why main passes pathToClaudeCodeExecutable", async () => {
  const resourcesPath = await app.evaluate(() => process.resourcesPath);
  const binaryPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude.exe`;

  // The same resolution the SDK does from its own folder, run inside the packaged main process.
  const sdkPath = await app.evaluate(({ app: electronApp }, request) => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const { join: joinPath } = process.getBuiltinModule('node:path');
    const sdkEntry = joinPath(electronApp.getAppPath(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs');
    return createRequire(sdkEntry).resolve(request);
  }, binaryPackage);

  expect(sdkPath.startsWith(join(resourcesPath, 'app.asar') + sep)).toBe(true);
  expect(toUnpackedPath(sdkPath)).toBe(
    resolveClaudeExecutable({
      platform: process.platform,
      arch: process.arch,
      isPackaged: true,
      resourcesPath,
      resolve: () => '',
      exists: existsSync,
    }),
  );
});
