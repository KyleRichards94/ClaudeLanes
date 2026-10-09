import { BUILD_DIAGNOSTICS_MAX } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createDiagnosticCollector, parseDiagnosticLine, stripAnsi } from './parse';

describe('parseDiagnosticLine', () => {
  it('reads an MSBuild compiler error with its location, code and project', () => {
    expect(
      parseDiagnosticLine(
        "C:\\src\\.agent-lanes\\71273\\OnSite\\JobControl.razor.cs(42,17): error CS0246: The type or namespace name 'JobFilterState' could not be found (are you missing a using directive or an assembly reference?) [C:\\src\\.agent-lanes\\71273\\OnSite\\OnSite.csproj]",
      ),
    ).toEqual({
      severity: 'error',
      code: 'CS0246',
      message: "The type or namespace name 'JobFilterState' could not be found (are you missing a using directive or an assembly reference?)",
      file: 'C:\\src\\.agent-lanes\\71273\\OnSite\\JobControl.razor.cs',
      line: 42,
      column: 17,
    });
  });

  it('reads MSBuild warnings, line-only locations, ranges and indented summary lines', () => {
    expect(parseDiagnosticLine('    Grid.cs(7): warning CS0168: The variable \'e\' is declared but never used [App.csproj]')).toMatchObject({
      severity: 'warning',
      code: 'CS0168',
      file: 'Grid.cs',
      line: 7,
      column: null,
    });
    expect(parseDiagnosticLine('Grid.cs(7,3,7,9): error CS1002: ; expected')).toMatchObject({ line: 7, column: 3, message: '; expected' });
  });

  it('reads tool-wide MSBuild messages without a file', () => {
    expect(parseDiagnosticLine('MSBUILD : error MSB1009: Project file does not exist.')).toEqual({
      severity: 'error',
      code: 'MSB1009',
      message: 'Project file does not exist.',
      file: null,
      line: null,
      column: null,
    });
    expect(parseDiagnosticLine('CSC : error CS2001: Source file \'x.cs\' could not be found. [App.csproj]')).toMatchObject({ code: 'CS2001', file: null });
    expect(parseDiagnosticLine('C:\\Program Files\\dotnet\\sdk\\9.0.100\\Microsoft.Common.CurrentVersion.targets(2413,5): warning MSB3277: Found conflicts')).toMatchObject({
      severity: 'warning',
      code: 'MSB3277',
      file: 'C:\\Program Files\\dotnet\\sdk\\9.0.100\\Microsoft.Common.CurrentVersion.targets',
      line: 2413,
    });
    expect(parseDiagnosticLine('error TS18003: No inputs were found in config file.')).toMatchObject({ code: 'TS18003', file: null });
  });

  it('reads tsc in both its plain and pretty formats', () => {
    expect(parseDiagnosticLine("src/app.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.")).toMatchObject({
      code: 'TS2322',
      file: 'src/app.ts',
      line: 3,
      column: 5,
    });
    expect(parseDiagnosticLine("\u001b[96msrc/app.ts\u001b[0m:\u001b[93m3\u001b[0m:\u001b[93m5\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2304: \u001b[0mCannot find name 'useGrid'.")).toEqual({
      severity: 'error',
      code: 'TS2304',
      message: "Cannot find name 'useGrid'.",
      file: 'src/app.ts',
      line: 3,
      column: 5,
    });
  });

  it('reads the eslint unix and compact formats', () => {
    expect(parseDiagnosticLine("/repo/src/a.ts:10:2: 'x' is assigned a value but never used. [Error/no-unused-vars]")).toEqual({
      severity: 'error',
      code: 'no-unused-vars',
      message: "'x' is assigned a value but never used.",
      file: '/repo/src/a.ts',
      line: 10,
      column: 2,
    });
    expect(parseDiagnosticLine('C:\\repo\\src\\a.ts: line 4, col 1, Warning - Unexpected console statement. (no-console)')).toMatchObject({
      severity: 'warning',
      code: 'no-console',
      file: 'C:\\repo\\src\\a.ts',
      line: 4,
    });
  });

  it('leaves ordinary output alone', () => {
    for (const line of [
      '  Determining projects to restore...',
      'Build succeeded.',
      '    0 Warning(s)',
      'Time Elapsed 00:00:04.12',
      '  OnSite -> C:\\src\\OnSite\\bin\\Debug\\net8.0\\OnSite.dll',
      '> vite build',
      '',
    ]) {
      expect(parseDiagnosticLine(line), line).toBeNull();
    }
  });
});

describe('createDiagnosticCollector', () => {
  it('counts each MSBuild error once although the summary repeats it', () => {
    const collector = createDiagnosticCollector();
    const log = [
      'Build started 07/10/2026 14:01:12.',
      'C:\\w\\A.cs(1,1): error CS0246: The type or namespace name \'JobFilterState\' could not be found [C:\\w\\App.csproj]',
      'C:\\w\\B.cs(2,1): error CS0103: The name \'grid\' does not exist in the current context [C:\\w\\App.csproj]',
      'C:\\w\\C.cs(3,1): warning CS0168: The variable \'e\' is declared but never used [C:\\w\\App.csproj]',
      'C:\\w\\D.cs(4,1): error CS1002: ; expected [C:\\w\\App.csproj]',
      '',
      'Build FAILED.',
      '',
      'C:\\w\\C.cs(3,1): warning CS0168: The variable \'e\' is declared but never used [C:\\w\\App.csproj]',
      'C:\\w\\A.cs(1,1): error CS0246: The type or namespace name \'JobFilterState\' could not be found [C:\\w\\App.csproj]',
      'C:\\w\\B.cs(2,1): error CS0103: The name \'grid\' does not exist in the current context [C:\\w\\App.csproj]',
      'C:\\w\\D.cs(4,1): error CS1002: ; expected [C:\\w\\App.csproj]',
      '    1 Warning(s)',
      '    3 Error(s)',
    ];
    const levels = log.map((line) => collector.read(line).level);

    expect(collector.counts()).toEqual({ errors: 3, warnings: 1 });
    expect(collector.firstError()).toMatchObject({ code: 'CS0246', file: 'C:\\w\\A.cs' });
    expect(collector.diagnostics().map((item) => item.code)).toEqual(['CS0246', 'CS0103', 'CS1002', 'CS0168']);
    // "Build FAILED." and "3 Error(s)" are summary lines, not errors of their own: the log's error count matches the panel's (AL-254).
    expect(levels).toEqual(['info', 'error', 'error', 'warning', 'error', 'info', 'info', 'info', 'warning', 'error', 'error', 'error', 'info', 'info']);
  });

  it('reads eslint stylish blocks by their file line', () => {
    const collector = createDiagnosticCollector();
    for (const line of [
      '',
      'C:\\repo\\src\\a.ts',
      "  3:7   error    'x' is assigned a value but never used  @typescript-eslint/no-unused-vars",
      '  9:1   warning  Unexpected console statement            no-console',
      '',
      '/repo/src/b.tsx',
      '  1:1  error  Parsing error: Unexpected token',
      '',
      '✖ 3 problems (2 errors, 1 warning)',
    ]) {
      collector.read(line);
    }
    expect(collector.counts()).toEqual({ errors: 2, warnings: 1 });
    expect(collector.diagnostics()).toEqual([
      {
        severity: 'error',
        code: '@typescript-eslint/no-unused-vars',
        message: "'x' is assigned a value but never used",
        file: 'C:\\repo\\src\\a.ts',
        line: 3,
        column: 7,
      },
      { severity: 'error', code: null, message: 'Parsing error: Unexpected token', file: '/repo/src/b.tsx', line: 1, column: 1 },
      { severity: 'warning', code: 'no-console', message: 'Unexpected console statement', file: 'C:\\repo\\src\\a.ts', line: 9, column: 1 },
    ]);
  });

  it('ignores indented items that follow no file line', () => {
    const collector = createDiagnosticCollector();
    collector.read('  3:7   error    looks like eslint  some-rule');
    expect(collector.counts()).toEqual({ errors: 0, warnings: 0 });
  });

  it('marks npm failures as error lines without counting them as diagnostics', () => {
    const collector = createDiagnosticCollector();
    expect(collector.read('npm ERR! code ELIFECYCLE').level).toBe('error');
    expect(collector.read('npm WARN deprecated left-pad').level).toBe('warning');
    expect(collector.read('    0 Error(s)').level).toBe('info');
    expect(collector.counts()).toEqual({ errors: 0, warnings: 0 });
  });

  it('keeps every count but at most BUILD_DIAGNOSTICS_MAX diagnostics', () => {
    const collector = createDiagnosticCollector();
    for (let i = 1; i <= BUILD_DIAGNOSTICS_MAX + 50; i += 1) collector.read(`A.cs(${i},1): error CS1002: ; expected`);
    expect(collector.counts().errors).toBe(BUILD_DIAGNOSTICS_MAX + 50);
    expect(collector.diagnostics()).toHaveLength(BUILD_DIAGNOSTICS_MAX);
  });

  it('strips terminal colour codes', () => {
    expect(stripAnsi('\u001b[31merror\u001b[39m done\u001b]8;;http://x\u0007link\u001b]8;;\u0007')).toBe('error donelink');
  });
});
