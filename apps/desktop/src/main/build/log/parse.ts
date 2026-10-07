import { BUILD_DIAGNOSTICS_MAX, type BuildDiagnostic, type BuildLogLevel } from '@agent-lanes/contracts';

/**
 * Reads compiler and linter diagnostics off a build log (AL-132, design §10):
 *
 * - **MSBuild / dotnet** (and tsc without `--pretty`): `File.cs(42,17): error CS0246: message [proj.csproj]`,
 *   `CSC : error CS2001: message`, `MSBUILD : error MSB1009: message`.
 * - **tsc pretty:** `src/a.ts:3:5 - error TS2322: message`.
 * - **eslint:** the default "stylish" output (a file line, then `  3:5  error  message  rule`), and the
 *   `unix` and `compact` formatters.
 *
 * MSBuild repeats every error in its summary, so the collector counts each distinct diagnostic once.
 */

// eslint-disable-next-line no-control-regex -- terminal escape sequences are what this removes
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** The line without terminal colour and cursor codes. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** `origin(line,col): [fatal] error CODE: message [project]`; the location and code are optional. */
const MSBUILD =
  /^(?<origin>\S.*?)(?:\((?<loc>\d+(?:,\d+){0,3}(?:-\d+)?)\))?\s*:\s*(?:fatal\s+)?(?<sev>error|warning)(?:\s+(?<code>[A-Za-z]+[A-Za-z0-9]*\d+))?\s*:\s*(?<msg>.*?)(?:\s+\[(?<project>[^\]]+)\])?$/;
/** A tool-wide message with no origin: `error TS18003: No inputs were found …`. */
const BARE = /^(?<sev>error|warning)\s+(?<code>[A-Za-z]+\d+)\s*:\s*(?<msg>.+)$/;
const TSC_PRETTY = /^(?<file>\S.*?):(?<line>\d+):(?<col>\d+)\s+-\s+(?<sev>error|warning)\s+(?<code>TS\d+):\s*(?<msg>.+)$/;
const ESLINT_UNIX = /^(?<file>\S.*?):(?<line>\d+):(?<col>\d+):\s*(?<msg>.+?)\s+\[(?<sev>Error|Warning)(?:\/(?<rule>[^\]]+))?\]$/;
const ESLINT_COMPACT = /^(?<file>\S.*?): line (?<line>\d+), col (?<col>\d+), (?<sev>Error|Warning) - (?<msg>.+?)(?:\s+\((?<rule>[^)\s]+)\))?$/;
/** eslint stylish item under a file line: `  3:5  error  'x' is defined but never used  no-unused-vars`. */
const ESLINT_STYLISH_ITEM = /^\s+(?<line>\d+):(?<col>\d+)\s+(?<sev>error|warning)\s+(?<msg>.+?)(?:\s{2,}(?<rule>[@\w\-/]+))?$/;
/** eslint stylish file line: a path with an extension, alone on its line. */
const ESLINT_STYLISH_FILE = /^(?:[A-Za-z]:)?[^\s:]*[\\/][^\s:]*\.\w+$|^(?:[A-Za-z]:\\|\/)\S.*\.\w+$/;

/** Origins that are tools, not files: `CSC : error CS2001`, `MSBUILD : error MSB1009`. */
function isFileOrigin(origin: string, hasLocation: boolean): boolean {
  return hasLocation || /[\\/]/.test(origin) || /\.\w+$/.test(origin);
}

function positive(value: string | undefined): number | null {
  if (value === undefined) return null;
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function severity(value: string): BuildDiagnostic['severity'] {
  return value.toLowerCase() === 'warning' ? 'warning' : 'error';
}

function diagnostic(fields: {
  sev: string;
  code?: string | undefined;
  msg: string;
  file?: string | null | undefined;
  line?: string | undefined;
  col?: string | undefined;
}): BuildDiagnostic | null {
  const message = fields.msg.trim();
  if (!message) return null;
  return {
    severity: severity(fields.sev),
    code: fields.code?.trim() || null,
    message,
    file: fields.file?.trim() || null,
    line: positive(fields.line),
    column: positive(fields.col),
  };
}

/** A diagnostic on one line in any of the formats except eslint stylish (which needs the file line above it). */
export function parseDiagnosticLine(rawLine: string): BuildDiagnostic | null {
  const line = stripAnsi(rawLine).trim();
  if (!line) return null;

  const pretty = TSC_PRETTY.exec(line)?.groups;
  if (pretty) return diagnostic({ sev: pretty['sev']!, code: pretty['code'], msg: pretty['msg']!, file: pretty['file'], line: pretty['line'], col: pretty['col'] });

  const unix = ESLINT_UNIX.exec(line)?.groups;
  if (unix) return diagnostic({ sev: unix['sev']!, code: unix['rule'], msg: unix['msg']!, file: unix['file'], line: unix['line'], col: unix['col'] });

  const compact = ESLINT_COMPACT.exec(line)?.groups;
  if (compact) return diagnostic({ sev: compact['sev']!, code: compact['rule'], msg: compact['msg']!, file: compact['file'], line: compact['line'], col: compact['col'] });

  const bare = BARE.exec(line)?.groups;
  if (bare) return diagnostic({ sev: bare['sev']!, code: bare['code'], msg: bare['msg']! });

  const msbuild = MSBUILD.exec(line)?.groups;
  if (msbuild) {
    const origin = msbuild['origin']!.trim();
    const [lineNo, col] = (msbuild['loc'] ?? '').split(/[,-]/);
    return diagnostic({
      sev: msbuild['sev']!,
      code: msbuild['code'],
      msg: msbuild['msg']!,
      file: isFileOrigin(origin, msbuild['loc'] !== undefined) ? origin : null,
      line: lineNo || undefined,
      col: col || undefined,
    });
  }
  return null;
}

/** Lines that read as errors or warnings without being a diagnostic the parser knows (`npm ERR!`, `Build FAILED.`). */
const ERROR_LINE = /^\s*(?:npm ERR!|ERR!|error\b|fatal\b|Build FAILED\b|ELIFECYCLE\b)|\berror\(s\)|\bERR_[A-Z_]+\b/i;
const WARNING_LINE = /^\s*(?:npm WARN|warn(?:ing)?\b)/i;

export interface LineReading {
  level: BuildLogLevel;
  diagnostic: BuildDiagnostic | null;
}

export interface DiagnosticCollector {
  /** Reads one log line (colour codes are ignored): its level for the Build log tab, and its diagnostic if any. */
  read(line: string): LineReading;
  /** Distinct errors, then distinct warnings, each in log order, at most BUILD_DIAGNOSTICS_MAX. */
  diagnostics(): BuildDiagnostic[];
  /** Distinct errors and warnings seen, however many. */
  counts(): { errors: number; warnings: number };
  /** The first distinct error, for the card's activity line. */
  firstError(): BuildDiagnostic | null;
}

function keyOf(item: BuildDiagnostic): string {
  return [item.severity, item.file ?? '', item.line ?? '', item.column ?? '', item.code ?? '', item.message].join('\u0000');
}

export function createDiagnosticCollector(): DiagnosticCollector {
  const seen = new Set<string>();
  const errors: BuildDiagnostic[] = [];
  const warnings: BuildDiagnostic[] = [];
  let errorCount = 0;
  let warningCount = 0;
  /** The file an eslint stylish block is about; cleared by a blank line. */
  let stylishFile: string | null = null;

  function add(item: BuildDiagnostic): void {
    const key = keyOf(item);
    if (seen.has(key)) return;
    seen.add(key);
    if (item.severity === 'error') {
      errorCount += 1;
      if (errors.length < BUILD_DIAGNOSTICS_MAX) errors.push(item);
    } else {
      warningCount += 1;
      if (warnings.length < BUILD_DIAGNOSTICS_MAX) warnings.push(item);
    }
  }

  return {
    read(rawLine) {
      const line = stripAnsi(rawLine);
      if (!line.trim()) {
        stylishFile = null;
        return { level: 'info', diagnostic: null };
      }

      if (stylishFile !== null) {
        const item = ESLINT_STYLISH_ITEM.exec(line)?.groups;
        if (item) {
          const found = diagnostic({ sev: item['sev']!, code: item['rule'], msg: item['msg']!, file: stylishFile, line: item['line'], col: item['col'] });
          if (found) {
            add(found);
            return { level: found.severity, diagnostic: found };
          }
        }
      }

      const found = parseDiagnosticLine(line);
      if (found) {
        stylishFile = null;
        add(found);
        return { level: found.severity, diagnostic: found };
      }

      if (ESLINT_STYLISH_FILE.test(line.trim()) && !/^\s/.test(line)) stylishFile = line.trim();
      if (ERROR_LINE.test(line) && !/\b0 error\(s\)/i.test(line)) return { level: 'error', diagnostic: null };
      if (WARNING_LINE.test(line)) return { level: 'warning', diagnostic: null };
      return { level: 'info', diagnostic: null };
    },

    diagnostics() {
      return [...errors, ...warnings].slice(0, BUILD_DIAGNOSTICS_MAX);
    },

    counts() {
      return { errors: errorCount, warnings: warningCount };
    },

    firstError() {
      return errors[0] ?? null;
    },
  };
}
