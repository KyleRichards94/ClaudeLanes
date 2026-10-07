import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from 'electron';

/**
 * Finds the native `claude` binary that the Agent SDK runs (ticket AL-007; used by AL-100 as
 * `options.pathToClaudeCodeExecutable`).
 *
 * The SDK resolves `@anthropic-ai/claude-agent-sdk-<platform>/claude[.exe]` from its own folder. In the
 * packaged app that folder is inside `app.asar`, so the path it gets back points into the archive.
 * Electron's asar shim makes that path look like it exists, but `child_process.spawn` is not
 * asar-aware and cannot start it. electron-builder unpacks the SDK packages (`asarUnpack` in
 * electron-builder.yml) to `resources/app.asar.unpacked/`, so the packaged app looks there instead.
 */

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

export interface ClaudeExecutableLookup {
  platform: NodeJS.Platform;
  arch: string;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `process.resourcesPath`; only read when packaged. */
  resourcesPath: string;
  /** Resolves a module request to a file path (`require.resolve`); only used in dev. */
  resolve: (request: string) => string;
  exists: (path: string) => boolean;
  /** Linux only: try the musl build first (the SDK does this when glibc is absent). */
  preferMusl?: boolean;
}

/** Platform packages that may hold the binary, in the order the SDK tries them. */
export function claudeBinaryPackages(platform: NodeJS.Platform, arch: string, preferMusl = false): string[] {
  if (platform === 'android') return [`${SDK_PACKAGE}-linux-${arch}-android`];
  if (platform === 'linux') {
    const glibc = `${SDK_PACKAGE}-linux-${arch}`;
    const musl = `${SDK_PACKAGE}-linux-${arch}-musl`;
    return preferMusl ? [musl, glibc] : [glibc, musl];
  }
  return [`${SDK_PACKAGE}-${platform}-${arch}`];
}

export function claudeBinaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'claude.exe' : 'claude';
}

/** Maps a path inside `app.asar` to the same file in `app.asar.unpacked`; other paths are unchanged. */
export function toUnpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
}

/** Absolute path of the `claude` binary, or `null` when no platform package is installed. */
export function resolveClaudeExecutable(lookup: ClaudeExecutableLookup): string | null {
  const binary = claudeBinaryName(lookup.platform);

  for (const pkg of claudeBinaryPackages(lookup.platform, lookup.arch, lookup.preferMusl)) {
    const candidate = lookup.isPackaged
      ? join(lookup.resourcesPath, 'app.asar.unpacked', 'node_modules', ...pkg.split('/'), binary)
      : resolveQuietly(lookup.resolve, `${pkg}/${binary}`);
    if (candidate && lookup.exists(candidate)) return toUnpackedPath(candidate);
  }

  return null;
}

/** The lookup for this process: the running Electron app, Node's resolver, the real file system. */
export function claudeExecutableLookup(electronApp: Pick<App, 'isPackaged'>): ClaudeExecutableLookup {
  return {
    platform: process.platform,
    arch: process.arch,
    isPackaged: electronApp.isPackaged,
    resourcesPath: process.resourcesPath,
    // The main bundle is CommonJS (electron-vite), so `require` is Node's resolver from out/main.
    resolve: (request) => require.resolve(request),
    exists: existsSync,
  };
}

function resolveQuietly(resolve: (request: string) => string, request: string): string | null {
  try {
    return resolve(request);
  } catch {
    return null;
  }
}
