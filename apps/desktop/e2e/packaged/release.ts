import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Paths of the `pnpm package` output for the version in apps/desktop/package.json (ticket AL-007). */

const appDir = join(__dirname, '..', '..');

export const appPackage = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
  version: string;
  productName: string;
};

export const releaseDir = join(appDir, 'release', appPackage.version);
export const unpackedDir = join(releaseDir, 'win-unpacked');
export const exeName = `${appPackage.productName}.exe`;
export const unpackedExe = join(unpackedDir, exeName);
export const installerPath = join(releaseDir, `${appPackage.productName}-${appPackage.version}-setup.exe`);

/** The Claude Code version the installed Agent SDK ships (its `claude --version` output starts with it). */
export const claudeCodeVersion = (
  JSON.parse(readFileSync(join(dirname(require.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8')) as {
    claudeCodeVersion: string;
  }
).claudeCodeVersion;

/** Runs a PowerShell snippet and returns its trimmed output. */
export function powershell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}
