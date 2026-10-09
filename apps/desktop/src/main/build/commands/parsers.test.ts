import { describe, expect, it } from 'vitest';
import { classifyProject, isTestProjectName, rankRunProjects } from './dotnet-project';
import { nodeCommands, packageManagerFromField, packageManagerFromLockfiles } from './node-package';
import { parseSln, parseSlnx } from './solution';

describe('parseSln', () => {
  it('lists projects in order with their ids, skipping solution folders, web sites and absolute paths', () => {
    const text = [
      'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Docs", "Docs", "{1}"',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "src\\Core\\Core.csproj", "{2a637ed2-302e-4926-852a-b0a865f60bbc}"',
      'Project("{E24C65DC-7377-472B-9ABA-BC803B73C61A}") = "Site", "http://localhost/Site", "{3}"',
      'Project("{F184B08F-C81C-45F6-A57F-5ABD9991F28F}") = "Legacy", "Legacy\\Legacy.vbproj"',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Abs", "C:\\x\\Abs.csproj", "{5}"',
    ].join('\r\n');
    expect(parseSln(text)).toEqual([
      { name: 'Core', path: 'src/Core/Core.csproj', id: '2A637ED2-302E-4926-852A-B0A865F60BBC' },
      { name: 'Legacy', path: 'Legacy/Legacy.vbproj' },
    ]);
  });
});

describe('parseSlnx', () => {
  it('reads project paths, inside folders too, and ignores commented-out ones', () => {
    const text = `<Solution>
      <!-- <Project Path="Old/Old.csproj" /> -->
      <Folder Name="/src/"><Project Path="src/App/App.csproj" /></Folder>
      <Project Path='tests\\App.Tests\\App.Tests.csproj' Type="Classic C#" />
    </Solution>`;
    expect(parseSlnx(text)).toEqual([
      { name: 'App', path: 'src/App/App.csproj' },
      { name: 'App.Tests', path: 'tests/App.Tests/App.Tests.csproj' },
    ]);
  });
});

describe('classifyProject', () => {
  it.each([
    ['Web', '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>', { sdkStyle: true, kind: 'web', test: false }],
    ['Desk', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType></PropertyGroup></Project>', { sdkStyle: true, kind: 'desktop', test: false }],
    ['Wpf', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><UseWPF>true</UseWPF></PropertyGroup></Project>', { sdkStyle: true, kind: 'desktop', test: false }],
    ['Cli', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>', { sdkStyle: true, kind: 'console', test: false }],
    ['Lib', '<Project Sdk="Microsoft.NET.Sdk"></Project>', { sdkStyle: true, kind: null, test: false }],
    ['Old', '<Project ToolsVersion="15.0"><PropertyGroup><OutputType>WinExe</OutputType></PropertyGroup></Project>', { sdkStyle: false, kind: 'desktop', test: false }],
    ['App.Tests', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>', { sdkStyle: true, kind: 'console', test: true }],
    ['Checks', '<Project Sdk="MSTest.Sdk/3.6.0"></Project>', { sdkStyle: true, kind: null, test: true }],
  ] as const)('%s', (name, xml, expected) => {
    expect(classifyProject(name, xml)).toEqual(expected);
  });

  it('lets IsTestProject decide over the name', () => {
    expect(classifyProject('Foo.Tests', '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><IsTestProject>false</IsTestProject></PropertyGroup></Project>').test).toBe(false);
  });
});

describe('isTestProjectName', () => {
  it.each([
    ['Foo.Tests', true],
    ['Foo-test', true],
    ['FooTests', true],
    ['Foo.UnitTests', true],
    ['Latest', false],
    ['Contest', false],
  ])('%s → %s', (name, expected) => {
    expect(isTestProjectName(name)).toBe(expected);
  });
});

describe('rankRunProjects', () => {
  it('keeps SDK-style runnable non-test projects, web then desktop then console, stable within a kind', () => {
    const p = (name: string, kind: 'web' | 'desktop' | 'console' | null, sdkStyle = true, test = false) => ({ name, info: { kind, sdkStyle, test } });
    const ranked = rankRunProjects([p('Cli', 'console'), p('Lib', null), p('Old', 'desktop', false), p('Tests', 'console', true, true), p('Desk', 'desktop'), p('Web', 'web'), p('Cli2', 'console')]);
    expect(ranked.map(({ name }) => name)).toEqual(['Web', 'Desk', 'Cli', 'Cli2']);
  });

  const project = (name: string, id: string, kind: 'web' | 'desktop' | null = 'desktop') => ({ name, id, info: { kind, sdkStyle: true, test: false } });
  const onSite = [project('DatabuildGateway.WinExe', 'A'), project('Gateway.Web', 'B', 'web'), project('OnSiteCompanion.WinExe', 'C'), project('OnSiteCompanion.Core', 'D', null)];

  it("puts a project named like the solution first, ahead of a web project", () => {
    const ranked = rankRunProjects(onSite, { solutionName: 'OnSite Companion Solution' });
    expect(ranked.map(({ name }) => name)).toEqual(['OnSiteCompanion.WinExe', 'Gateway.Web', 'DatabuildGateway.WinExe']);
  });

  it("puts Visual Studio's start-up project first, but not one dotnet cannot run", () => {
    expect(rankRunProjects(onSite, { startupId: 'a', solutionName: 'OnSite Companion Solution' })[0]?.name).toBe('DatabuildGateway.WinExe');
    expect(rankRunProjects(onSite, { startupId: 'D', solutionName: 'OnSite Companion Solution' })[0]?.name).toBe('OnSiteCompanion.WinExe');
  });
});

describe('package manager', () => {
  it('reads the packageManager field', () => {
    expect(packageManagerFromField('pnpm@10.34.6')).toBe('pnpm');
    expect(packageManagerFromField('yarn@4.5.0+sha512.abc')).toBe('yarn');
    expect(packageManagerFromField('deno@2')).toBeNull();
    expect(packageManagerFromField(42)).toBeNull();
  });

  it('trusts lockfiles in order', () => {
    expect(packageManagerFromLockfiles(['package-lock.json', 'pnpm-lock.yaml'])).toBe('pnpm');
    expect(packageManagerFromLockfiles(['bun.lockb'])).toBe('bun');
    expect(packageManagerFromLockfiles(['README.md'])).toBeNull();
  });
});

describe('nodeCommands', () => {
  it('ignores blank, non-string and inherited scripts', () => {
    expect(nodeCommands({ scripts: { build: '  ', start: 1, dev: 'vite' } }, 'npm')).toEqual({ build: null, run: 'npm run dev', runScript: 'dev' });
    expect(nodeCommands({ scripts: [] }, 'npm')).toEqual({ build: null, run: null, runScript: null });
    expect(nodeCommands(null, 'npm')).toEqual({ build: null, run: null, runScript: null });
  });
});
