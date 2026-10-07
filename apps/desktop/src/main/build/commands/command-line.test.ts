import { describe, expect, it } from 'vitest';
import { commandLine, pathArg, quoteArg } from './command-line';

describe('quoteArg', () => {
  it.each([
    ['OnSite.sln', 'OnSite.sln'],
    ['src/App/App.csproj', 'src/App/App.csproj'],
    ['-c', '-c'],
    ['Debug', 'Debug'],
    ['', '""'],
    ['OnSite Companion Solution.sln', '"OnSite Companion Solution.sln"'],
    ["Kyle's App (x86) & more/App.csproj", `"Kyle's App (x86) & more/App.csproj"`],
    ['a|b<c>d^e;f', '"a|b<c>d^e;f"'],
  ])('%j → %s', (arg, expected) => {
    expect(quoteArg(arg)).toBe(expected);
  });

  it.each(['say "hi".sln', '100%.sln', '%PATH%.sln', 'wow!.sln', '$HOME.sln', 'tick`.sln', 'back\\slash.sln', 'line\nbreak.sln'])(
    'refuses %j, which double quotes cannot protect in both shells',
    (arg) => {
      expect(quoteArg(arg)).toBeNull();
    },
  );
});

describe('commandLine', () => {
  it('joins quoted arguments', () => {
    expect(commandLine(['dotnet', 'build', 'OnSite Companion Solution.sln', '-c', 'Debug'])).toBe(
      'dotnet build "OnSite Companion Solution.sln" -c Debug',
    );
  });

  it('gives no command line when an argument cannot be quoted', () => {
    expect(commandLine(['dotnet', 'build', '%TEMP%.sln'])).toBeNull();
  });
});

describe('pathArg', () => {
  it('uses forward slashes', () => {
    expect(pathArg('OnSiteCompanion\\WinExe\\OnSiteCompanion.WinExe.csproj')).toBe('OnSiteCompanion/WinExe/OnSiteCompanion.WinExe.csproj');
  });

  it('keeps a file named like an option from being read as one', () => {
    expect(pathArg('-c.sln')).toBe('./-c.sln');
    expect(pathArg('src/-c.sln')).toBe('src/-c.sln');
  });
});
