import { readFile } from 'node:fs/promises';
import { arch, homedir, release } from 'node:os';
import type { AppInfo, DiagnosticsReport, LoggedProblem } from '@agent-lanes/contracts';
import type { Logger } from '../logging';
import type { SecretStore, SecretStoreIssue } from '../secrets';

/**
 * "Copy diagnostics" (AL-214): versions, settings without secrets and recent errors, as one report
 * a user can paste into a bug. Everything goes through the log's redactor, so a token that slipped
 * into a setting or an error message comes out as `[REDACTED]`.
 */
export interface Diagnostics {
  collect(): Promise<DiagnosticsReport>;
}

export interface DiagnosticsOptions {
  appInfo: () => AppInfo;
  /** Supplies the recent problems, the log folder and the redactor. */
  log: Logger;
  /** Reports whether tokens can be encrypted and how many are saved; never reads one. */
  secrets?: Pick<SecretStore, 'status' | 'list'>;
  /** The current settings, in whatever shape the settings store keeps them. */
  settings?: () => unknown;
  os?: { release: string; arch: string };
  homeDirectory?: string;
  now?: () => Date;
}

type ReportBody = Omit<DiagnosticsReport, 'text'>;

export function createDiagnostics(options: DiagnosticsOptions): Diagnostics {
  const now = options.now ?? (() => new Date());
  const home = options.homeDirectory ?? homedir();
  const os = options.os ?? { release: release(), arch: arch() };
  const { redactor } = options.log;

  return {
    async collect() {
      const body: ReportBody = {
        generatedAt: now().toISOString(),
        app: options.appInfo(),
        os,
        logDirectory: tildify(options.log.directory, home),
        settings: redactor.redactValue(await readSettings(options.settings)),
        secureStorage: options.secrets ? await describeSecureStorage(options.secrets) : null,
        recentErrors: options.log.recentProblems(),
      };
      return { ...body, text: redactor.redactText(formatDiagnostics(body)) };
    },
  };
}

async function readSettings(source: (() => unknown) | undefined): Promise<unknown> {
  if (!source) return null;
  try {
    return (await source()) ?? null;
  } catch (cause) {
    return { unreadable: cause instanceof Error ? cause.message : String(cause) };
  }
}

async function describeSecureStorage(secrets: Pick<SecretStore, 'status' | 'list'>): Promise<NonNullable<DiagnosticsReport['secureStorage']>> {
  const [status, saved] = await Promise.all([secrets.status(), secrets.list()]);
  return {
    encryptionAvailable: status.encryptionAvailable,
    savedEntries: saved.length,
    issues: status.issues.map(describeIssue),
  };
}

function describeIssue(issue: SecretStoreIssue): string {
  switch (issue.kind) {
    case 'file-unreadable':
      return `secrets file unreadable (${issue.reason})${issue.backupPath ? '; the old file was kept' : ''}`;
    case 'entry-invalid':
      return `${issue.id}: malformed entry dropped`;
    case 'entry-undecryptable':
      return `${issue.id}: cannot be decrypted on this machine`;
  }
}

/**
 * Reads the settings document the app wrote (`<userData>/settings.json`, AL-041) as plain JSON, so
 * diagnostics work before and after the settings service exists. Null when there is none yet.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    if (code === 'ENOENT') return null;
    return { unreadable: typeof code === 'string' ? code : 'unknown error' };
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { unreadable: 'not valid JSON' };
  }
}

/** Shows the user's home folder as `~`, so a pasted report carries less about the machine. */
export function tildify(path: string, home: string): string {
  if (!home) return path;
  const windows = /^[A-Za-z]:[\\/]/.test(home);
  const matches = windows ? path.toLowerCase().startsWith(home.toLowerCase()) : path.startsWith(home);
  const next = path.charAt(home.length);
  return matches && (next === '' || next === '/' || next === '\\') ? `~${path.slice(home.length)}` : path;
}

export function formatDiagnostics(report: ReportBody): string {
  const { app, os } = report;
  const lines = [
    'Agent Lanes diagnostics',
    `Generated ${report.generatedAt}`,
    '',
    'Versions',
    `  ${app.name} ${app.version}`,
    `  Electron ${app.versions.electron} · Chrome ${app.versions.chrome} · Node ${app.versions.node}`,
    `  ${app.platform} ${os.release} (${os.arch})`,
    '',
    'Log folder',
    `  ${report.logDirectory}`,
    '',
    'Secure storage',
    ...(report.secureStorage
      ? [
          `  Encryption available: ${report.secureStorage.encryptionAvailable ? 'yes' : 'no'}`,
          `  Saved tokens: ${report.secureStorage.savedEntries}`,
          `  Issues: ${report.secureStorage.issues.length === 0 ? 'none' : report.secureStorage.issues.join('; ')}`,
        ]
      : ['  Not available']),
    '',
    'Settings',
    indent(report.settings === null || report.settings === undefined ? 'None saved yet' : JSON.stringify(report.settings, null, 2)),
    '',
    `Recent errors (${report.recentErrors.length === 0 ? 'none' : `${report.recentErrors.length}, newest last`})`,
    ...report.recentErrors.map(formatProblem),
  ];
  return `${lines.join('\n')}\n`;
}

function formatProblem(problem: LoggedProblem): string {
  const head = `  ${problem.at} ${problem.level.toUpperCase()} [${problem.scope}] ${problem.message}`;
  return problem.detail ? `${head}\n${indent(problem.detail, '    ')}` : head;
}

function indent(text: string, prefix = '  '): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
