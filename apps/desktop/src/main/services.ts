import { join } from 'node:path';
import { safeStorage, type BrowserWindow } from 'electron';
import { readAppInfo } from './app/app-info';
import { createJobQueue, type JobQueue } from './build';
import { createAdoConnectionTester, createConnectionsService, type ConnectionsService } from './connections';
import { createElectronConnectionsFile } from './connections/electron-connections-file';
import { createDesignNavigationPolicy, createDesignViewService, type DesignViewService } from './design';
import { createElectronDesignPlatform } from './design/electron-platform';
import { createDiagnostics, type Diagnostics } from './diagnostics';
import { createGitService, type GitService } from './git';
import type { Emit } from './ipc/emit';
import { LOG_DIRECTORY_NAME, createLogger, type Logger } from './logging';
import { createElectronRepoDialogs, createRepoRegistry, type RepoRegistry } from './repos';
import { SECRETS_FILE_NAME, createSecretStore, type SafeStorageLike, type SecretStore } from './secrets';
import { createElectronSettingsFile } from './settings/electron-settings-file';
import { createSettingsService, type SettingsService } from './settings/service';
import { createTicketRecordStore, ticketsRootDir, type TicketRecordStore } from './tickets';

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
  /** Build and run job queue (AL-131): FIFO, one job per worktree, `buildQueueSize` jobs at once. */
  readonly buildQueue: JobQueue;
  /** `git(args, { cwd })`, porcelain reads and the version check (AL-080). Main-only; no IPC channel of its own. */
  readonly git: GitService;
  /** Rotating, redacted log in `<userData>/logs` (AL-214). Hand each service `log.child('<scope>')`. */
  readonly log: Logger;
  /** Versions, settings without secrets and recent errors, for "Copy diagnostics" (AL-214). */
  readonly diagnostics: Diagnostics;
  /** ADO orgs, Claude and MCP servers in `<userData>/connections.json`, their tokens in `secrets` (AL-042). */
  readonly connections: ConnectionsService;
  /** Claude Design canvas views over the design tab (AL-191): hidden, never destroyed, on tab switches. */
  readonly designView: DesignViewService;
  /** Ticket records in `<userData>/tickets/<repoKey>/<ticketId>.json` (AL-101, D8); never inside a worktree. */
  readonly tickets: TicketRecordStore;
  /** Registered repos in settings, added through the native folder picker (AL-081). */
  readonly repos: RepoRegistry;
}

export interface ServiceOptions {
  appDataDir: string;
  /** Electron's safeStorage unless a test passes a fake (`./secrets/testing`). */
  safeStorage?: SafeStorageLike;
  emit: Emit;
  /** The app log; index.ts creates it before anything else so start-up problems are logged. */
  log?: Logger;
  /** The main window the design views are drawn in (AL-191); undefined while there is none. */
  mainWindow?: () => BrowserWindow | null | undefined;
  /** Extra origin the design view treats as claude.ai: the e2e fake site, unpackaged builds only (AL-191). */
  designTestOrigin?: string;
}

export function createServices(options: ServiceOptions): Services {
  const log = options.log ?? createLogger({ directory: join(options.appDataDir, LOG_DIRECTORY_NAME) });
  const secrets = createSecretStore({
    filePath: join(options.appDataDir, SECRETS_FILE_NAME),
    safeStorage: options.safeStorage ?? safeStorage,
    warn: (message) => log.child('secrets').warn(message),
    onPlaintext: (secret) => log.redactor.addSecret(secret),
  });

  const settingsStore = createSettingsService({
    file: createElectronSettingsFile(options.appDataDir),
    warn: (message) => log.child('settings').warn(message),
  });
  // Concurrency follows the `buildQueueSize` setting (AL-041), read at each scheduling decision.
  const buildQueue = createJobQueue({ concurrency: () => settingsStore.get().buildQueueSize });
  const settings: SettingsService = {
    get: () => settingsStore.get(),
    update(patch) {
      const result = settingsStore.update(patch);
      // A larger queue size starts waiting jobs straight away.
      if (result.ok) buildQueue.refresh();
      return result;
    },
  };
  // Queue transitions reach the renderer as `build:queued` (AL-012).
  buildQueue.subscribe((event) => options.emit('build:queued', event));
  const tickets = createTicketRecordStore({
    rootDir: ticketsRootDir(options.appDataDir),
    warn: (message) => log.child('tickets').warn(message),
  });

  const git = createGitService();
  const repos = createRepoRegistry({ git, settings, dialogs: createElectronRepoDialogs() });

  const diagnostics = createDiagnostics({
    appInfo: readAppInfo,
    log,
    secrets,
    // The settings service's current settings (AL-041); diagnostics redact them before reporting.
    settings: () => settings.get(),
  });

  const connections = createConnectionsService({
    file: createElectronConnectionsFile(options.appDataDir),
    secrets,
    emit: options.emit,
    testers: { ado: createAdoConnectionTester() },
    warn: (message) => log.child('connections').warn(message),
  });

  const designPolicy = createDesignNavigationPolicy({ claudeOrigins: options.designTestOrigin ? [options.designTestOrigin] : [] });
  const designView = createDesignViewService({
    platform: createElectronDesignPlatform({ window: options.mainWindow ?? (() => undefined), policy: designPolicy }),
    policy: designPolicy,
    emit: options.emit,
  });

  return {
    appDataDir: options.appDataDir,
    secrets,
    emit: options.emit,
    settings,
    buildQueue,
    git,
    log,
    diagnostics,
    connections,
    designView,
    tickets,
    repos,
  };
}

/** Stops child processes and flushes state on quit (AL-213 fills this in). */
export async function disposeServices(services: Services): Promise<void> {
  void services;
  await services.buildQueue.dispose();
  // After the queue, so a build that finished while stopping is still saved to its ticket.
  await services.tickets.dispose();
  // Closes the canvas views and flushes the claude.ai sign-in cookies to disk (D112).
  await services.designView.dispose();
}
