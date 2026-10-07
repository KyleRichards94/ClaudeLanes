import { describe, expect, it } from 'vitest';
import { invokeContracts } from '../schemas';
import { RepoCommandsSchema, resolveRepoCommands, type DetectedCommands } from './build.schemas';

const onsite: DetectedCommands = {
  toolchain: 'dotnet',
  manifest: 'OnSite.sln',
  packageManager: null,
  build: 'dotnet build OnSite.sln -c Debug',
  run: 'dotnet run --project OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj',
  runTarget: 'OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj',
  runKind: 'desktop',
};

const repo = { path: 'C:\\src\\onsite-companion', buildCommand: null, runCommand: null };

describe('resolveRepoCommands', () => {
  it('uses the detected commands when the repo has no overrides', () => {
    const commands = resolveRepoCommands(repo, onsite);

    expect(commands).toEqual({
      repoPath: repo.path,
      detected: onsite,
      build: { command: 'dotnet build OnSite.sln -c Debug', origin: 'detected' },
      run: { command: 'dotnet run --project OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj', origin: 'detected' },
    });
    expect(RepoCommandsSchema.parse(commands)).toEqual(commands);
  });

  it('lets each override replace its own command only', () => {
    const commands = resolveRepoCommands({ ...repo, runCommand: '  dotnet run --project Web/Web.csproj --launch-profile https ' }, onsite);

    expect(commands.build).toEqual({ command: 'dotnet build OnSite.sln -c Debug', origin: 'detected' });
    expect(commands.run).toEqual({ command: 'dotnet run --project Web/Web.csproj --launch-profile https', origin: 'override' });
    // What was detected is still reported, for the settings panel to show beside the override.
    expect(commands.detected).toBe(onsite);
  });

  it('treats a blank override as unset', () => {
    const commands = resolveRepoCommands({ ...repo, buildCommand: '   ' }, onsite);
    expect(commands.build).toEqual({ command: 'dotnet build OnSite.sln -c Debug', origin: 'detected' });
  });

  it('keeps overrides when nothing is detected, and reports no command when there are neither', () => {
    expect(resolveRepoCommands({ ...repo, buildCommand: 'make' }, null)).toEqual({
      repoPath: repo.path,
      detected: null,
      build: { command: 'make', origin: 'override' },
      run: null,
    });
    expect(resolveRepoCommands(repo, { ...onsite, run: null, runTarget: null, runKind: null }).run).toBeNull();
  });
});

describe('build:commands contract', () => {
  it('takes a repo path and nothing else', () => {
    const { request } = invokeContracts['build:commands'];
    expect(request.safeParse({ repoPath: repo.path }).success).toBe(true);
    expect(request.safeParse({ repoPath: '' }).success).toBe(false);
    expect(request.safeParse({ repoPath: repo.path, dir: 'C:\\elsewhere' }).success).toBe(false);
    expect(request.safeParse(undefined).success).toBe(false);
  });

  it('refuses an empty command or an unknown origin', () => {
    const { response } = invokeContracts['build:commands'];
    const valid = resolveRepoCommands(repo, onsite);
    expect(response.safeParse(valid).success).toBe(true);
    expect(response.safeParse({ ...valid, build: { command: '', origin: 'detected' } }).success).toBe(false);
    expect(response.safeParse({ ...valid, build: { command: 'x', origin: 'file' } }).success).toBe(false);
  });
});
