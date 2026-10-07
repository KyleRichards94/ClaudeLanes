import { join } from 'node:path';
import { safeStorage } from 'electron';
import { createAdoConnectionTester, createConnectionsService, type ConnectionsService } from './connections';
import { createElectronConnectionsFile } from './connections/electron-connections-file';
import type { Emit } from './ipc/emit';
import { SECRETS_FILE_NAME, createSecretStore, type SafeStorageLike, type SecretStore } from './secrets';
import { createElectronSettingsFile } from './settings/electron-settings-file';
import { createSettingsService, type SettingsService } from './settings/service';

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
  /** App settings and UI prefs in `<userData>/settings.json` (AL-041). */
  readonly settings: SettingsService;
  /** ADO orgs, Claude and MCP servers in `<userData>/connections.json`, their tokens in `secrets` (AL-042). */
  readonly connections: ConnectionsService;
}

export interface ServiceOptions {
  appDataDir: string;
  /** Electron's safeStorage unless a test passes a fake (`./secrets/testing`). */
  safeStorage?: SafeStorageLike;
  emit: Emit;
}

export function createServices(options: ServiceOptions): Services {
  const secrets = createSecretStore({
    filePath: join(options.appDataDir, SECRETS_FILE_NAME),
    safeStorage: options.safeStorage ?? safeStorage,
  });

  return {
    appDataDir: options.appDataDir,
    secrets,
    emit: options.emit,
    settings: createSettingsService({ file: createElectronSettingsFile(options.appDataDir) }),
    connections: createConnectionsService({
      file: createElectronConnectionsFile(options.appDataDir),
      secrets,
      emit: options.emit,
      testers: { ado: createAdoConnectionTester() },
    }),
  };
}

/** Stops child processes and flushes state on quit (AL-213 fills this in). */
export async function disposeServices(services: Services): Promise<void> {
  void services;
}
