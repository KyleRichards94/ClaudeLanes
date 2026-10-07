import { defaultSettings, type DetectedCommands, type RepoSettings, type Settings } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createBuildCommands } from './service';

const onsite: DetectedCommands = {
  toolchain: 'dotnet',
  manifest: 'OnSite.sln',
  packageManager: null,
  build: 'dotnet build OnSite.sln -c Debug',
  run: 'dotnet run --project OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj',
  runTarget: 'OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj',
  runKind: 'desktop',
};

function repo(overrides: Partial<RepoSettings> = {}): RepoSettings {
  return {
    path: 'C:\\src\\OnSite',
    name: 'OnSite Companion',
    baseBranch: 'main',
    worktreeRoot: 'C:\\src\\.agent-lanes',
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: 3,
    ...overrides,
  };
}

function settingsWith(...repos: RepoSettings[]): { get: () => Settings } {
  return { get: () => ({ ...defaultSettings(), repos }) };
}

describe('createBuildCommands', () => {
  it('resolves OnSite Companion to `dotnet build OnSite.sln -c Debug`, matching the path without case on Windows', async () => {
    const detect = vi.fn(async () => onsite);
    const commands = createBuildCommands({ settings: settingsWith(repo()), platform: 'win32', detect });

    const result = await commands.forRepo('c:\\SRC\\onsite');

    expect(result).toEqual({
      ok: true,
      data: {
        repoPath: 'C:\\src\\OnSite',
        detected: onsite,
        build: { command: 'dotnet build OnSite.sln -c Debug', origin: 'detected' },
        run: { command: onsite.run, origin: 'detected' },
      },
    });
    expect(detect).toHaveBeenCalledWith('C:\\src\\OnSite');
  });

  it("applies the repo's overrides from settings", async () => {
    const commands = createBuildCommands({
      settings: settingsWith(repo({ buildCommand: 'dotnet build OnSite.sln -c Release', runCommand: 'dotnet run --project Web/Web.csproj' })),
      platform: 'win32',
      detect: async () => onsite,
    });

    const result = await commands.forRepo('C:\\src\\OnSite');
    expect(result.ok && result.data.build).toEqual({ command: 'dotnet build OnSite.sln -c Release', origin: 'override' });
    expect(result.ok && result.data.run).toEqual({ command: 'dotnet run --project Web/Web.csproj', origin: 'override' });
  });

  it('detects in a ticket worktree when one is given', async () => {
    const detect = vi.fn(async () => null);
    const commands = createBuildCommands({ settings: settingsWith(repo()), platform: 'win32', detect });
    await commands.forRepo('C:\\src\\OnSite', { dir: 'C:\\src\\.agent-lanes\\AL-1' });
    expect(detect).toHaveBeenCalledWith('C:\\src\\.agent-lanes\\AL-1');
  });

  it('refuses a path that is not a registered repo', async () => {
    const commands = createBuildCommands({ settings: settingsWith(repo()), platform: 'win32', detect: async () => onsite });
    await expect(commands.forRepo('C:\\src\\Other')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
