import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

/** The desktop app's folder (apps/desktop). */
export const appDir = join(__dirname, '..', '..');

/** Where the gallery build goes: beside `out/`, git-ignored. */
export const galleryOutDir = join(appDir, 'out-gallery');

/**
 * The component gallery (AL-032) is left out of production builds, and `pnpm e2e` tests the production
 * build in `out/`. This builds the app once more with the gallery in (`--mode gallery`, the same
 * switch `pnpm dev` turns on) into `out-gallery/`, with a package.json so Electron can start it as an
 * app folder. Takes a few seconds.
 */
export function buildGallery(): void {
  // Through node, so the same command works on Windows without a shell (electron-vite's bin is a .cmd shim there).
  const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js');
  execFileSync(process.execPath, [cli, 'build', '--mode', 'gallery', '--outDir', galleryOutDir], {
    cwd: appDir,
    stdio: 'pipe',
  });
  writeFileSync(
    join(galleryOutDir, 'package.json'),
    JSON.stringify({ name: 'agent-lanes-gallery', productName: 'Agent Lanes', version: '0.0.0-gallery', main: 'main/index.js' }),
  );
}

export interface GalleryApp {
  app: ElectronApplication;
  userDataDir: string;
  close(): Promise<void>;
}

/** Starts the gallery build on a throwaway profile, opened at `#/gallery`. */
export async function launchGallery(): Promise<GalleryApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-gallery-'));
  const app = await electron.launch({
    args: [galleryOutDir],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  return {
    app,
    userDataDir,
    async close() {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
