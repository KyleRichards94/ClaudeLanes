import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeBinaryPackages,
  claudeExecutableLookup,
  resolveClaudeExecutable,
  toUnpackedPath,
  type ClaudeExecutableLookup,
} from './claude-executable';

const resourcesPath = join('C:', 'Users', 'kyle', 'AppData', 'Local', 'Programs', 'agent-lanes', 'resources');
const unpackedBinary = join(
  resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk-win32-x64',
  'claude.exe',
);

function lookup(overrides: Partial<ClaudeExecutableLookup>): ClaudeExecutableLookup {
  return {
    platform: 'win32',
    arch: 'x64',
    isPackaged: false,
    resourcesPath,
    resolve: () => {
      throw new Error('Cannot find module');
    },
    exists: () => true,
    ...overrides,
  };
}

describe('claudeBinaryPackages', () => {
  it('names the platform package the SDK installs', () => {
    expect(claudeBinaryPackages('win32', 'x64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64']);
    expect(claudeBinaryPackages('darwin', 'arm64')).toEqual(['@anthropic-ai/claude-agent-sdk-darwin-arm64']);
  });

  it('tries glibc then musl on Linux, or musl first when asked', () => {
    expect(claudeBinaryPackages('linux', 'x64')).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    ]);
    expect(claudeBinaryPackages('linux', 'arm64', true)).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
      '@anthropic-ai/claude-agent-sdk-linux-arm64',
    ]);
  });
});

describe('toUnpackedPath', () => {
  it('moves a path inside app.asar to app.asar.unpacked', () => {
    expect(toUnpackedPath('C:\\App\\resources\\app.asar\\node_modules\\x\\claude.exe')).toBe(
      'C:\\App\\resources\\app.asar.unpacked\\node_modules\\x\\claude.exe',
    );
    expect(toUnpackedPath('/opt/App/resources/app.asar/node_modules/x/claude')).toBe(
      '/opt/App/resources/app.asar.unpacked/node_modules/x/claude',
    );
  });

  it('leaves unpacked and dev paths alone', () => {
    const unpacked = 'C:\\App\\resources\\app.asar.unpacked\\node_modules\\x\\claude.exe';
    expect(toUnpackedPath(unpacked)).toBe(unpacked);
    expect(toUnpackedPath('C:\\repo\\node_modules\\x\\claude.exe')).toBe('C:\\repo\\node_modules\\x\\claude.exe');
  });
});

describe('resolveClaudeExecutable', () => {
  it('uses the SDK platform package from node_modules in dev', () => {
    const requests: string[] = [];
    const devPath = join('C:', 'repo', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');

    const found = resolveClaudeExecutable(
      lookup({
        resolve: (request) => {
          requests.push(request);
          return devPath;
        },
      }),
    );

    expect(requests).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe']);
    expect(found).toBe(devPath);
  });

  it('uses app.asar.unpacked in the packaged app, never a path inside the archive', () => {
    const checked: string[] = [];

    const found = resolveClaudeExecutable(
      lookup({
        isPackaged: true,
        exists: (path) => {
          checked.push(path);
          return path === unpackedBinary;
        },
      }),
    );

    expect(found).toBe(unpackedBinary);
    expect(checked).toEqual([unpackedBinary]);
  });

  it('rewrites an archive path a resolver might return in dev to the unpacked copy', () => {
    const inArchive = join(resourcesPath, 'app.asar', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe');

    expect(resolveClaudeExecutable(lookup({ resolve: () => inArchive }))).toBe(unpackedBinary);
  });

  it('falls through to the next Linux package when the first is missing', () => {
    const found = resolveClaudeExecutable(
      lookup({
        platform: 'linux',
        isPackaged: true,
        resourcesPath: '/opt/agent-lanes/resources',
        exists: (path) => path.includes('linux-x64-musl'),
      }),
    );

    expect(found).toBe(
      join('/opt/agent-lanes/resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64-musl', 'claude'),
    );
  });

  it('returns null when no platform package is installed', () => {
    expect(resolveClaudeExecutable(lookup({}))).toBeNull();
    expect(resolveClaudeExecutable(lookup({ isPackaged: true, exists: () => false }))).toBeNull();
  });
});

describe('claudeExecutableLookup', () => {
  it('finds the Agent SDK binary installed in node_modules (dev)', () => {
    const found = resolveClaudeExecutable(claudeExecutableLookup({ isPackaged: false }));

    expect(found).not.toBeNull();
    expect(existsSync(found ?? '')).toBe(true);
    expect(found).toMatch(/node_modules[\\/]@anthropic-ai[\\/]claude-agent-sdk-[^\\/]+[\\/]claude(\.exe)?$/);
  });
});
