import { spawn, type ChildProcess } from 'node:child_process';
import type { BuildLogStream } from '@agent-lanes/contracts';
import { createLineSplitter } from '../log/lines';

/**
 * Starts a build or run command line in a worktree (AL-132, AL-133). Commands are command lines
 * (detected or the user's override, AL-130), so they run through the platform shell: cmd.exe on
 * Windows, /bin/sh elsewhere. Output arrives line by line; colour is turned off where tools allow.
 */

export interface CommandExit {
  /** Null when the process was killed by a signal or never started. */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Why the process could not be started (missing folder, no shell); undefined when it ran. */
  error?: Error;
}

export interface CommandProcess {
  /** The shell's process id; undefined when it could not be started. */
  readonly pid: number | undefined;
  /** Settles once the process exited and its output was read. Never rejects. */
  readonly exit: Promise<CommandExit>;
  /** Stops the process; resolves once the stop was requested. Safe to call after it exited. */
  kill(): Promise<void>;
}

export interface StartCommandOptions {
  command: string;
  cwd: string;
  /** Added to the app's environment, after the colour switches, so a caller can override them. */
  env?: Record<string, string>;
  onLine(stream: BuildLogStream, text: string): void;
  platform?: NodeJS.Platform;
}

export type StartCommand = (options: StartCommandOptions) => CommandProcess;

/** Plain output from dotnet, MSBuild, node tools and npm-style runners, so the log parses cleanly. */
export const PLAIN_OUTPUT_ENV: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  NPM_CONFIG_COLOR: 'false',
  DOTNET_NOLOGO: '1',
  DOTNET_CLI_UI_LANGUAGE: 'en',
  MSBUILDTERMINALLOGGER: 'off',
};

export const startCommand: StartCommand = ({ command, cwd, env, onLine, platform = process.platform }) => {
  let child: ChildProcess;
  try {
    child = spawn(command, {
      cwd,
      env: { ...process.env, ...PLAIN_OUTPUT_ENV, ...env },
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group outside Windows, so Stop can end the whole tree (AL-134).
      detached: platform !== 'win32',
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return { pid: undefined, exit: Promise.resolve({ exitCode: null, signal: null, error }), kill: () => Promise.resolve() };
  }

  const stdout = createLineSplitter((line) => onLine('stdout', line));
  const stderr = createLineSplitter((line) => onLine('stderr', line));
  child.stdout?.on('data', (chunk: Buffer) => stdout.write(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.write(chunk));

  const exit = new Promise<CommandExit>((resolve) => {
    let failed: Error | undefined;
    child.once('error', (error) => {
      failed = error;
      // 'close' does not always follow a spawn failure.
      if (child.pid === undefined) finish(null, null);
    });
    child.once('close', (code, signal) => finish(code, signal));
    let done = false;
    function finish(exitCode: number | null, signal: NodeJS.Signals | null): void {
      if (done) return;
      done = true;
      stdout.end();
      stderr.end();
      resolve(failed ? { exitCode, signal, error: failed } : { exitCode, signal });
    }
  });

  return {
    pid: child.pid,
    exit,
    kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      return Promise.resolve();
    },
  };
};
