import { join } from 'node:path';
import { safeStorage } from 'electron';
import { readAppInfo } from './app/app-info';
import { createDiagnostics, readJsonFile, type Diagnostics } from './diagnostics';
import type { Emit } from './ipc/emit';
import { LOG_DIRECTORY_NAME, createLogger, type Logger } from './logging';
import { SECRETS_FILE_NAME, createSecretStore, type SafeStorageLike, type SecretStore } from './secrets';

/**
 * Composition root for main-process services (design §4: each service owns one external system).
 * Each service lives in its own folder under src/main/<domain>/ and is created here, once, so
 * services can be handed to each other and to the IPC handler factories.
 *
 * Add one property per service; keep creation order so a service is created after the ones it needs.
 */
export interface Services {
  /** Main window accessors etc. are added here as services need them. */
  readonly appDataDir: string;
  /** Encrypted tokens (AL-040). Main-only: hand it to other services; no IPC channel returns a secret. */
  readonly secrets: SecretStore;
  /** Pushes typed events to the renderer (AL-012); services hold this, never the window. */
  readonly emit: Emit;
  /** Rotating, redacted log in `<userData>/logs` (AL-214). Hand each service `log.child('<scope>')`. */
  readonly log: Logger;
  /** Versions, settings without secrets and recent errors, for "Copy diagnostics" (AL-214). */
  readonly diagnostics: Diagnostics;
}

export interface ServiceOptions {
  appDataDir: string;
  /** Electron's safeStorage unless a test passes a fake (`./secrets/testing`). */
  safeStorage?: SafeStorageLike;
  emit: Emit;
  /** The app log; index.ts creates it before anything else so start-up problems are logged. */
  log?: Logger;
}

export function createServices(options: ServiceOptions): Services {
  const log = options.log ?? createLogger({ directory: join(options.appDataDir, LOG_DIRECTORY_NAME) });
  const secrets = createSecretStore({
    filePath: join(options.appDataDir, SECRETS_FILE_NAME),
    safeStorage: options.safeStorage ?? safeStorage,
    warn: (message) => log.child('secrets').warn(message),
    onPlaintext: (secret) => log.redactor.addSecret(secret),
  });
  const diagnostics = createDiagnostics({
    appInfo: readAppInfo,
    log,
    secrets,
    // The settings document the settings store writes (AL-041); read as JSON until its service is merged.
    settings: () => readJsonFile(join(options.appDataDir, 'settings.json')),
  });

  return {
    appDataDir: options.appDataDir,
    secrets,
    emit: options.emit,
    log,
    diagnostics,
  };
}

/** Stops child processes and flushes state on quit (AL-213 fills this in). */
export async function disposeServices(services: Services): Promise<void> {
  void services;
}
