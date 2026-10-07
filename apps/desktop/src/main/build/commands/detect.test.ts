import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectCommands } from './detect';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'al-detect-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes files under the temp folder; keys are forward-slashed relative paths. */
async function files(entries: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(entries)) {
    const full = join(dir, ...path.split('/'));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
}

const SLN_HEADER = 'Microsoft Visual Studio Solution File, Format Version 12.00\r\n# Visual Studio Version 17\r\n';
const CSHARP = '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}';
const FOLDER = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';

function sln(projects: ReadonlyArray<[type: string, name: string, path: string]>): string {
  return (
    '\uFEFF' +
    SLN_HEADER +
    projects.map(([type, name, path], i) => `Project("${type}") = "${name}", "${path}", "{0000000${i}-0000-0000-0000-000000000000}"\r\nEndProject\r\n`).join('') +
    'Global\r\nEndGlobal\r\n'
  );
}

const library = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>';
const winExe =
  '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType><UseWindowsForms>true</UseWindowsForms></PropertyGroup></Project>';
const web = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>';
const console = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>';
const tests =
  '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0" /></ItemGroup></Project>';

describe('detectCommands', () => {
  it('resolves an OnSite Companion-shaped repo to `dotnet build OnSite.sln -c Debug`', async () => {
    await files({
      'OnSite.sln': sln([
        [FOLDER, 'Solution Items', 'Solution Items'],
        [CSHARP, 'OnSiteCompanion.Core', 'OnSiteCompanion\\Core\\OnSiteCompanion.Core.csproj'],
        [CSHARP, 'OnSiteCompanion.Core.Tests', 'OnSiteCompanion\\Core.Tests\\OnSiteCompanion.Core.Tests.csproj'],
        [CSHARP, 'OnSiteCompanion.WinExe', 'OnSiteCompanion\\WinExe\\OnSiteCompanion.WinExe.csproj'],
      ]),
      'OnSiteCompanion/Core/OnSiteCompanion.Core.csproj': library,
      'OnSiteCompanion/Core.Tests/OnSiteCompanion.Core.Tests.csproj': tests,
      'OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj': winExe,
      // A package.json at the root (tooling) does not win over the solution.
      'package.json': JSON.stringify({ scripts: { build: 'gulp' } }),
    });

    await expect(detectCommands(dir)).resolves.toEqual({
      toolchain: 'dotnet',
      manifest: 'OnSite.sln',
      packageManager: null,
      build: 'dotnet build OnSite.sln -c Debug',
      run: 'dotnet run --project OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj',
      runTarget: 'OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj',
      runKind: 'desktop',
    });
  });

  it('runs a web project before a desktop or console one, and skips projects outside the repo', async () => {
    await files({
      'App.sln': sln([
        [CSHARP, 'Shared', '..\\Shared\\Shared.csproj'],
        [CSHARP, 'Tool', 'Tool\\Tool.csproj'],
        [CSHARP, 'Desk', 'Desk\\Desk.csproj'],
        [CSHARP, 'Web', 'Web\\Web.csproj'],
      ]),
      'Tool/Tool.csproj': console,
      'Desk/Desk.csproj': winExe,
      'Web/Web.csproj': web,
    });

    const detected = await detectCommands(dir);
    expect(detected).toMatchObject({ build: 'dotnet build App.sln -c Debug', run: 'dotnet run --project Web/Web.csproj', runKind: 'web' });
  });

  it('builds a solution without a runnable project and gives no run command', async () => {
    await files({ 'Lib.sln': sln([[CSHARP, 'Lib', 'Lib\\Lib.csproj']]), 'Lib/Lib.csproj': library });
    await expect(detectCommands(dir)).resolves.toMatchObject({ build: 'dotnet build Lib.sln -c Debug', run: null, runTarget: null, runKind: null });
  });

  it('prefers the solution with the most projects, and a .sln over a .slnx', async () => {
    await files({
      'Small.sln': sln([[CSHARP, 'A', 'A\\A.csproj']]),
      'Big.slnx': '<Solution><Project Path="A/A.csproj" /><Project Path="B/B.csproj" /></Solution>',
      'Big.sln': sln([
        [CSHARP, 'A', 'A\\A.csproj'],
        [CSHARP, 'B', 'B\\B.csproj'],
      ]),
      'A/A.csproj': library,
      'B/B.csproj': console,
    });
    await expect(detectCommands(dir)).resolves.toMatchObject({ manifest: 'Big.sln', build: 'dotnet build Big.sln -c Debug', run: 'dotnet run --project B/B.csproj' });
  });

  it('quotes a solution name with spaces', async () => {
    await files({ 'My App.sln': sln([[CSHARP, 'App', 'App\\App.csproj']]), 'App/App.csproj': console });
    await expect(detectCommands(dir)).resolves.toMatchObject({ build: 'dotnet build "My App.sln" -c Debug' });
  });

  it('builds a root project file when there is no solution', async () => {
    await files({ 'Api.csproj': web });
    await expect(detectCommands(dir)).resolves.toEqual({
      toolchain: 'dotnet',
      manifest: 'Api.csproj',
      packageManager: null,
      build: 'dotnet build Api.csproj -c Debug',
      run: 'dotnet run --project Api.csproj',
      runTarget: 'Api.csproj',
      runKind: 'web',
    });
  });

  it('finds a solution one folder down', async () => {
    await files({ 'src/App.sln': sln([[CSHARP, 'App', 'App\\App.csproj']]), 'src/App/App.csproj': console, 'README.md': '# hi' });
    await expect(detectCommands(dir)).resolves.toMatchObject({ build: 'dotnet build src/App.sln -c Debug', run: 'dotnet run --project src/App/App.csproj' });
  });

  it("uses package.json's build and start scripts with the repo's package manager", async () => {
    await files({ 'package.json': JSON.stringify({ scripts: { build: 'tsc', start: 'node .', dev: 'vite' } }), 'pnpm-lock.yaml': '' });
    await expect(detectCommands(dir)).resolves.toEqual({
      toolchain: 'node',
      manifest: 'package.json',
      packageManager: 'pnpm',
      build: 'pnpm run build',
      run: 'pnpm run start',
      runTarget: 'start',
      runKind: 'script',
    });
  });

  it('falls back to the dev script, prefers the packageManager field, and defaults to npm', async () => {
    await files({ 'package.json': JSON.stringify({ packageManager: 'yarn@4.5.0', scripts: { dev: 'vite' } }), 'package-lock.json': '{}' });
    await expect(detectCommands(dir)).resolves.toMatchObject({ packageManager: 'yarn', build: null, run: 'yarn run dev', runTarget: 'dev' });

    await files({ 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) });
    await rm(join(dir, 'package-lock.json'));
    await expect(detectCommands(dir)).resolves.toMatchObject({ packageManager: 'npm', build: 'npm run build', run: null, runKind: null });
  });

  it('gives null for a folder with nothing to build, a package.json without scripts, or a missing folder', async () => {
    await expect(detectCommands(dir)).resolves.toBeNull();
    await files({ 'package.json': '{ "name": "x" }', 'node_modules/dep/Dep.sln': sln([]) });
    await expect(detectCommands(dir)).resolves.toBeNull();
    await files({ 'package.json': '{ not json' });
    await expect(detectCommands(dir)).resolves.toBeNull();
    await expect(detectCommands(join(dir, 'missing'))).resolves.toBeNull();
  });
});
