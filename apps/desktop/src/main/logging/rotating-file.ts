import { appendFileSync, copyFileSync, mkdirSync, renameSync, rmSync, statSync, truncateSync } from 'node:fs';
import { join, parse } from 'node:path';

/**
 * Append-only log file that rotates by size: `main.log` → `main.1.log` → … → `main.<maxFiles-1>.log`,
 * the oldest dropped. Writes are synchronous so the last lines before a crash are on disk, and the
 * log is small (errors and lifecycle, never agent output), so the cost is a few appends a minute.
 *
 * Nothing here throws: a log that cannot be written must never take a feature down with it.
 */
export interface RotatingFile {
  /** The file being written now. */
  readonly path: string;
  /** Every file this log may use, newest first. */
  paths(): string[];
  write(text: string): void;
}

export interface RotatingFileOptions {
  directory: string;
  /** Default `main.log`. */
  fileName?: string;
  /** Rotate before a write would take the file past this size. Default 1 MiB. */
  maxBytes?: number;
  /** Files kept, counting the current one. Default 5 (so at most ~5 MiB of logs). */
  maxFiles?: number;
  /** Called with the first write (or rotation) failure in a row; later ones stay quiet until it works again. */
  onError?: (error: unknown) => void;
}

export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_MAX_FILES = 5;

export function createRotatingFile(options: RotatingFileOptions): RotatingFile {
  const { directory } = options;
  const maxBytes = Math.max(1024, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const maxFiles = Math.max(1, Math.floor(options.maxFiles ?? DEFAULT_MAX_FILES));
  const { name, ext } = parse(options.fileName ?? 'main.log');
  const path = join(directory, `${name}${ext}`);

  let size: number | undefined;
  // Report the first failure of each kind, then stay quiet until that kind of operation works again.
  let writeFailing = false;
  let rotationFailing = false;

  function rotatedPath(index: number): string {
    return index === 0 ? path : join(directory, `${name}.${index}${ext}`);
  }

  function currentSize(): number {
    if (size === undefined) {
      mkdirSync(directory, { recursive: true });
      try {
        size = statSync(path).size;
      } catch {
        size = 0;
      }
    }
    return size;
  }

  function rotate(): void {
    if (maxFiles === 1) {
      truncateSync(path, 0);
      size = 0;
      return;
    }
    rmSync(rotatedPath(maxFiles - 1), { force: true });
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      try {
        renameSync(rotatedPath(index), rotatedPath(index + 1));
      } catch (cause) {
        if (!isMissing(cause)) throw cause;
      }
    }
    try {
      renameSync(path, rotatedPath(1));
    } catch (cause) {
      if (isMissing(cause)) {
        size = 0;
        return;
      }
      // Windows refuses a rename while another process (a viewer, a virus scanner) has the file open;
      // copying then truncating gets the same result without moving it.
      copyFileSync(path, rotatedPath(1));
      truncateSync(path, 0);
    }
    size = 0;
  }

  return {
    path,
    paths: () => Array.from({ length: maxFiles }, (_, index) => rotatedPath(index)),
    write(text) {
      const bytes = Buffer.byteLength(text, 'utf8');
      try {
        if (currentSize() > 0 && currentSize() + bytes > maxBytes) {
          try {
            rotate();
            rotationFailing = false;
          } catch (cause) {
            // Keep logging into the oversized file rather than lose lines; try again next write.
            if (!rotationFailing) report(cause);
            rotationFailing = true;
          }
        }
        appendFileSync(path, text, { encoding: 'utf8', mode: 0o600 });
        size = currentSize() + bytes;
        writeFailing = false;
      } catch (cause) {
        size = undefined;
        if (!writeFailing) report(cause);
        writeFailing = true;
      }
    },
  };

  function report(cause: unknown): void {
    try {
      options.onError?.(cause);
    } catch {
      // The reporter itself failed; there is nowhere left to say so.
    }
  }
}

function isMissing(cause: unknown): boolean {
  return (cause as { code?: unknown } | null)?.code === 'ENOENT';
}
