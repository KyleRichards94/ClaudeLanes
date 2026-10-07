import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { appPackage, exeName, installerPath, powershell } from './release';

/**
 * Installs the NSIS installer silently into a temp folder, launches the installed app, uninstalls,
 * and checks nothing is left behind outside the app data folder (ticket AL-007).
 *
 * Opt-in (`AGENT_LANES_INSTALL_TEST=1 pnpm e2e:packaged`) because it adds and then removes real Start
 * menu and desktop shortcuts and an Add/Remove Programs entry for the current user. Meant for a clean
 * Windows VM or CI agent.
 */

test.skip(process.platform !== 'win32', 'The Windows installer is the only package target so far.');
test.skip(process.env['AGENT_LANES_INSTALL_TEST'] !== '1', 'Set AGENT_LANES_INSTALL_TEST=1 to install and uninstall for real.');
test.skip(!existsSync(installerPath), `No installer at ${installerPath}; run \`pnpm package\` first.`);

const shortcutName = `${appPackage.productName}.lnk`;

/** DisplayVersion of the Add/Remove Programs entry for this user, or empty when not installed. */
function installedVersion(): string {
  return powershell(
    `Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Get-ItemProperty | ` +
      `Where-Object { $_.DisplayName -eq '${appPackage.productName}' } | ForEach-Object { $_.DisplayVersion }`,
  );
}

function shortcutPaths(): string[] {
  const folders = powershell(
    "[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('Programs')",
  ).split(/\r?\n/);
  return folders.map((folder) => join(folder.trim(), shortcutName));
}

/** electron-builder's `%LOCALAPPDATA%\<package>-updater` folders for this app (build/installer.nsh removes them). */
function updaterCacheDirs(): string[] {
  const localAppData = process.env['LOCALAPPDATA'] ?? '';
  return readdirSync(localAppData).filter((name) => /agent-lanes.*-updater$/i.test(name));
}

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return condition();
}

test('installs per user, launches, and uninstalls without leaving files behind', async () => {
  test.setTimeout(300_000);
  test.skip(installedVersion() !== '', 'Agent Lanes is already installed for this user; uninstall it first.');

  // tmpdir() is a path without spaces on Windows (8.3 form), which NSIS's /D= needs.
  const installDir = join(mkdtempSync(join(tmpdir(), 'agent-lanes-install-')), 'app');
  const userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-installed-profile-'));

  try {
    const install = spawnSync(installerPath, ['/S', '/currentuser', `/D=${installDir}`], { windowsHide: true });
    expect(install.status, 'installer exit code').toBe(0);

    const installedExe = join(installDir, exeName);
    expect(existsSync(installedExe), installedExe).toBe(true);
    expect(installedVersion()).toBe(appPackage.version);
    for (const shortcut of shortcutPaths()) expect(existsSync(shortcut), shortcut).toBe(true);
    expect(updaterCacheDirs(), 'installer copy for an auto-updater').toEqual([]);

    const app = await electron.launch({
      executablePath: installedExe,
      args: [],
      env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
    });
    try {
      const page = await app.firstWindow();
      await expect(page.getByText('Agent board')).toBeVisible();
      await expect(page.getByTestId('runtime-info')).toContainText(`v${appPackage.version}`);
    } finally {
      await app.close();
    }

    // The uninstaller copies itself to %TEMP% and returns at once, so wait for the folder to go.
    const uninstall = spawnSync(join(installDir, `Uninstall ${appPackage.productName}.exe`), ['/S', '/currentuser'], {
      windowsHide: true,
    });
    expect(uninstall.status, 'uninstaller exit code').toBe(0);
    const removed = await waitUntil(() => !existsSync(installDir) || readdirSync(installDir).length === 0, 120_000);

    expect(removed, `${installDir} is empty after uninstall`).toBe(true);
    expect(installedVersion()).toBe('');
    for (const shortcut of shortcutPaths()) expect(existsSync(shortcut), shortcut).toBe(false);
    expect(updaterCacheDirs()).toEqual([]);
  } finally {
    rmSync(join(installDir, '..'), { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
