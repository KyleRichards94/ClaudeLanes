import { execFile } from 'node:child_process';

/**
 * Ends a process and everything it started (AL-134, design §10 Stop): `dotnet run` starts the app as a
 * grandchild, and the shell that runs a command line sits above both, so killing only the direct
 * child would leave the app running.
 *
 * - **Windows:** `taskkill /PID <pid> /T /F` ends the whole tree at once.
 * - **Elsewhere:** the command was started in its own process group (`detached`), so the group gets
 *   SIGTERM, then SIGKILL if it is still there after `graceMs`.
 *
 * Never throws: a process that is already gone counts as killed.
 */
export interface KillTreeOptions {
  platform?: NodeJS.Platform;
  /** POSIX only: how long the group has to exit after SIGTERM before SIGKILL. */
  graceMs?: number;
  /** Runs `taskkill`; tests pass a fake. */
  taskkill?: (args: string[]) => Promise<void>;
  /** `process.kill`; tests pass a fake. */
  signal?: (pid: number, signal: NodeJS.Signals | 0) => void;
}

export type KillTree = (pid: number, options?: KillTreeOptions) => Promise<void>;

export const DEFAULT_KILL_GRACE_MS = 3_000;

function runTaskkill(args: string[]): Promise<void> {
  return new Promise((resolve) => {
    // Exit code 128 means the process was already gone; either way there is nothing left to do.
    execFile('taskkill', args, { windowsHide: true, timeout: 15_000 }, () => resolve());
  });
}

function isAlive(signal: NonNullable<KillTreeOptions['signal']>, target: number): boolean {
  try {
    signal(target, 0);
    return true;
  } catch (cause) {
    // EPERM: it exists but belongs to someone else, which a group we started never does.
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const killTree: KillTree = async (pid, options = {}) => {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const platform = options.platform ?? process.platform;

  if (platform === 'win32') {
    await (options.taskkill ?? runTaskkill)(['/PID', String(pid), '/T', '/F']);
    return;
  }

  const signal = options.signal ?? ((target: number, name: NodeJS.Signals | 0) => void process.kill(target, name));
  const send = (name: NodeJS.Signals): void => {
    try {
      signal(-pid, name);
    } catch {
      // Not a group leader (or gone): signal the process itself.
      try {
        signal(pid, name);
      } catch {
        // Already gone.
      }
    }
  };

  send('SIGTERM');
  const deadline = Date.now() + (options.graceMs ?? DEFAULT_KILL_GRACE_MS);
  while (Date.now() < deadline) {
    if (!isAlive(signal, -pid) && !isAlive(signal, pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  send('SIGKILL');
};
