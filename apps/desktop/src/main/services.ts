import { join } from 'node:path';
import { app, safeStorage, shell, type BrowserWindow } from 'electron';
import { DEFAULT_MAX_CONCURRENT_AGENTS } from '@agent-lanes/contracts';
import { createAdoService, readRegisteredRemotes, type AdoService } from './ado';
import { adoConnectionIdFor, createStageComments } from './ado/stage-comments';
import { claudeExecutableLookup, resolveClaudeExecutable } from './agent/claude-executable';
import { createClaudeLauncher, loadClaudeSdk, type ClaudeLauncher } from './agent/claude-sdk';
import { createTranscriptService, type TranscriptService } from './agent/output/transcript';
import { createSessionManager, type SessionManager } from './agent/session-manager';
import { createUsageService, type UsageService } from './agent/usage/usage-service';
import { combineSessionExtras } from './agent/session-extras';
import { createMcpStatusMonitor, mcpSessionExtras, type McpStatusMonitor } from './agent/mcp';
import { createPermissionService, type PermissionService } from './agent/permissions';
import { createSubagentTracker, type SubagentTracker } from './agent/subagents/subagent-tracker';
import { createSessionRecovery, type SessionRecovery } from './agent/recovery';
import { createLaunchQueue, type LaunchQueue } from './agent/launch-queue';
import { createBuildContext } from './agent/build-context';
import { sdkStageServer, stageSessionExtras } from './agent/stages/stage-server';
import { createStageService, type StageService } from './agent/stages/stage-service';
import { readAppInfo } from './app/app-info';
import { createBuildService, createGitFingerprint, createJobQueue, createRunService, type BuildService, type JobQueue, type RunService } from './build';
import { createBuildCommands, type BuildCommands } from './build/commands';
import {
  adoMcpServerFor,
  createAdoConnectionTester,
  createClaudeConnectionTester,
  createClaudeLoginDetector,
  createConnectionsService,
  createMcpConnectionTester,
  type ConnectionsService,
} from './connections';
import { createElectronConnectionsFile } from './connections/electron-connections-file';
import { createDesignNavigationPolicy, createDesignViewService, type DesignViewService } from './design';
import { createDesignCanvasLinks, type DesignCanvasLinks } from './design/canvas-links';
import { createDesignArtboardReader, type DesignArtboardReader } from './design/artboards';
import { createDesignThreadService, designThreadsDir, type DesignThreadService } from './design/thread';
import { createElectronDesignPlatform } from './design/electron-platform';
import { createDiagnostics, type Diagnostics } from './diagnostics';
import { createGitService, type GitService } from './git';
import type { Emit } from './ipc/emit';
import { LOG_DIRECTORY_NAME, createLogger, type Logger } from './logging';
import { createElectronRepoDialogs, createRepoRegistry, type RepoRegistry } from './repos';
import { SECRETS_FILE_NAME, createSecretStore, type SafeStorageLike, type SecretStore } from './secrets';
import { createElectronSettingsFile } from './settings/electron-settings-file';
import { createSettingsService, type SettingsService } from './settings/service';
import { createSkillDiscovery, type SkillDiscovery } from './skills/skill-discovery';
import { createTicketRecordStore, ticketsRootDir, type TicketRecordStore } from './tickets';
import { createTicketWorktreeService, type TicketWorktreeService } from './worktrees';
import { createBranchStatusService, type BranchStatusService } from './worktrees/branch-status';
import { createMergeToMainService, type MergeToMainService } from './worktrees/merge-to-main';
import { createArchiveService, type ArchiveService } from './worktrees/archive';
import { createDiffService, type DiffService } from './worktrees/diff';
import { createMergeSubBranchesService, type MergeSubBranchesService } from './worktrees/merge-sub-branches';
import { createSubWorktreeService, subWorktreeHooks, type SubWorktreeService } from './worktrees/sub-worktree';
import { createKeyedQueue } from './worktrees/keyed-queue';
import { createTicketArchive, ticketsArchiveDir, type TicketArchive } from './tickets/archive-store';
import { createReconcileService, ignoredWorktreesFile, type ReconcileService } from './tickets/reconcile';
import { createCredentialFailureService, type CredentialFailureService } from './credentials/credential-failures';

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
  /** Build and run commands per repo: detected from its files, overridden by its settings (AL-130). */
  readonly buildCommands: BuildCommands;
  /** Build jobs in ticket worktrees: batched `build:log`, diagnostics, last build on the ticket (AL-132). */
  readonly builds: BuildService;
  /** Run jobs: build if stale, start in the worktree, free port and URL for web projects (AL-133). */
  readonly runs: RunService;
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
  /** Each ticket's linked canvas and the page it was left on, in its record (AL-193). */
  readonly designCanvases: DesignCanvasLinks;
  /** Reads a linked canvas's artboards through a short read-only design session (AL-195, D118). */
  readonly designArtboards: DesignArtboardReader;
  /** Each ticket's in-app design thread and its design session, separate from the lead agent (AL-196, D120). */
  readonly designThreads: DesignThreadService;
  /** Azure DevOps per organisation from `connections` (AL-065): the `ado:*` channels and work item write-back (AL-063). */
  readonly ado: AdoService;
  /** Ticket records in `<userData>/tickets/<repoKey>/<ticketId>.json` (AL-101, D8); never inside a worktree. */
  readonly tickets: TicketRecordStore;
  /** Registered repos in settings, added through the native folder picker (AL-081). */
  readonly repos: RepoRegistry;
  /** Starts Claude Code through the Agent SDK with the Claude connection's credential (AL-044; sessions, AL-100). */
  readonly claude: ClaudeLauncher;
  /** Creates a ticket's worktree and branch and records them on the ticket, or rolls everything back (AL-083). */
  readonly worktrees: TicketWorktreeService;
  /** One Claude Agent SDK session per ticket, in its worktree (AL-100). Main-only: holds the session processes. */
  readonly sessions: SessionManager;
  /** Each registered repo's skills from a short Claude Code session, cached per repo (`skills:list`, AL-114). */
  readonly skills: SkillDiscovery;
  /** Each ticket's normalised output (`agent:output`) and the buffer `agent:getTranscript` backfills from (AL-102). */
  readonly transcripts: TranscriptService;
  /** Moves tickets between lanes for the agent's `set_stage` and reports its activity (AL-103). */
  readonly stages: StageService;
  /** Each session's tokens, cost and context window (`agent:usage`, `agent:getUsage`, AL-113). */
  readonly usage: UsageService;
  /** The MCP servers of the running sessions for the header pill; reconnects a failing one (AL-108). */
  readonly mcpStatus: McpStatusMonitor;
  /** Headless permission policy and the "Needs you · permission" requests of each session (AL-109). */
  readonly permissions: PermissionService;
  /** Resumes a lost session once, then asks with the "MCP bridge lost the session" toast (AL-110). */
  readonly recovery: SessionRecovery;
  /** Per-repo cap on running agents and the Queued lane: every session start goes through it (AL-111). */
  readonly launches: LaunchQueue;
  /** Ticket branch vs base and sub-branches vs the ticket branch: ahead/behind, dirty, ready (AL-085). */
  readonly branches: BranchStatusService;
  /** Merge worktree → main: merges the ticket branch into its base, pushes, moves the card to Done (AL-087). */
  readonly mergeToMain: MergeToMainService;
  /** Archived tickets in `<userData>/tickets-archive` (AL-088). */
  readonly ticketArchive: TicketArchive;
  /** User-chosen Archive: removes the ticket's worktrees and moves its record to the archive list (AL-088). */
  readonly archive: ArchiveService;
  /** The Diff tab's files and per-file unified diffs against the base or a sub-branch (AL-089). */
  readonly diffs: DiffService;
  /** Start-up reconciliation: the board from ticket records checked against git's worktrees; Adopt / Ignore orphans (AL-090). */
  readonly reconcile: ReconcileService;
  /** Writer sub-agents' worktrees on `sub/<ticket>-<name>`, created through each session's WorktreeCreate hook (AL-084, D9). */
  readonly subWorktrees: SubWorktreeService;
  /** Each ticket's sub-agent tree and counts from its session (`agent:subagent`, AL-107). */
  readonly subagents: SubagentTracker;
  /** Merge sub-branches → ticket branch, stopping at the first conflict; Hand to lead agent / I'll resolve it (AL-086). */
  readonly mergeSubBranches: MergeSubBranchesService;
  /** A 401 from Azure DevOps turns its org red, pauses that org's agents and raises Reconnect; a reconnect resumes them (AL-048). */
  readonly credentialFailures: CredentialFailureService;
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
  /** A `claude` executable to start instead of the Agent SDK's: the e2e fake, unpackaged builds only (AL-044). */
  claudeExecutable?: string;
}

export function createServices(options: ServiceOptions): Services {
  // Assigned once the session manager exists (AL-048); connections and ADO report to it from then on.
  const late: { credentialFailures?: CredentialFailureService; subagents?: SubagentTracker } = {};
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
      if (result.ok) {
        buildQueue.refresh();
        // A raised agent cap starts queued launches (AL-111).
        void launches.refresh();
      }
      return result;
    },
  };
  const buildCommands = createBuildCommands({ settings });
  // Queue transitions reach the renderer as `build:queued` (AL-012).
  buildQueue.subscribe((event) => options.emit('build:queued', event));
  const tickets = createTicketRecordStore({
    rootDir: ticketsRootDir(options.appDataDir),
    warn: (message) => log.child('tickets').warn(message),
  });

  const git = createGitService();
  const builds = createBuildService({
    tickets,
    buildCommands,
    queue: buildQueue,
    emit: options.emit,
    fingerprint: createGitFingerprint(git),
    warn: (message) => log.child('build').warn(message),
    // The ticket's live session gets the result with its next turn (AL-112); `buildContext` is created below.
    onFinished: (result) => buildContext.onBuildFinished(result),
  });
  const runs = createRunService({
    tickets,
    buildCommands,
    builds,
    emit: options.emit,
    openExternal: (url) => shell.openExternal(url),
    warn: (message) => log.child('run').warn(message),
  });
  const repos = createRepoRegistry({ git, settings, dialogs: createElectronRepoDialogs() });
  const worktrees = createTicketWorktreeService({ git, settings, tickets, log: log.child('worktrees') });
  // A sub-branch is Ready only once its sub-agent finished (AL-107); the tracker is created after the sessions.
  const branches = createBranchStatusService({ git, tickets, subagents: { isRunning: (ticketId, name) => late.subagents?.isRunning(ticketId, name) ?? false } });
  // Merges and archives in one repo run one at a time.
  const repoQueue = createKeyedQueue();
  const mergeToMain = createMergeToMainService({ git, tickets, log: log.child('merge'), queue: repoQueue });
  const ticketArchive = createTicketArchive({ rootDir: ticketsArchiveDir(options.appDataDir), warn: (message) => log.child('archive').warn(message) });
  const archive = createArchiveService({ git, tickets, archive: ticketArchive, log: log.child('archive'), queue: repoQueue });
  const diffs = createDiffService({ git, tickets });
  const subWorktrees = createSubWorktreeService({ git, tickets, queue: repoQueue, log: log.child('worktrees') });
  const reconcile = createReconcileService({ git, settings, tickets, ignoredFile: ignoredWorktreesFile(options.appDataDir) });

  const diagnostics = createDiagnostics({
    appInfo: readAppInfo,
    log,
    secrets,
    // The settings service's current settings (AL-041); diagnostics redact them before reporting.
    settings: () => settings.get(),
  });

  // Claude Code through the Agent SDK (AL-044): the login check and the one-token test start it.
  const claude = createClaudeLauncher({
    executable: () => options.claudeExecutable ?? resolveClaudeExecutable(claudeExecutableLookup(app)),
    clientApp: `agent-lanes/${app.getVersion()}`,
  });

  const connections = createConnectionsService({
    file: createElectronConnectionsFile(options.appDataDir),
    secrets,
    emit: options.emit,
    testers: { ado: createAdoConnectionTester(), claude: createClaudeConnectionTester(claude), mcp: createMcpConnectionTester() },
    detectClaudeLogin: createClaudeLoginDetector(claude),
    // Each Azure DevOps Services organisation brings the official ADO MCP server (AL-045, AL-108).
    adoMcpServer: adoMcpServerFor,
    warn: (message) => log.child('connections').warn(message),
    // A reconnect resumes the agents a 401 paused (AL-048); created below, after the sessions.
    onChanged: () => void late.credentialFailures?.connectionsChanged(),
  });

  const designPolicy = createDesignNavigationPolicy({ claudeOrigins: options.designTestOrigin ? [options.designTestOrigin] : [] });
  const designView = createDesignViewService({
    platform: createElectronDesignPlatform({ window: options.mainWindow ?? (() => undefined), policy: designPolicy }),
    policy: designPolicy,
    emit: options.emit,
    // Each signed-in canvas page is remembered on the ticket record (AL-193).
    onChange: (view, closed) => designCanvases.noteView(view, closed),
  });
  const designCanvases = createDesignCanvasLinks({
    tickets,
    designView,
    testOrigin: options.designTestOrigin,
    warn: (message) => log.child('design').warn(message),
  });
  const designArtboards = createDesignArtboardReader({ claude, tickets, warn: (message) => log.child('design').warn(message) });
  const designThreads = createDesignThreadService({
    claude,
    tickets,
    emit: options.emit,
    dir: designThreadsDir(options.appDataDir),
    warn: (message) => log.child('design').warn(message),
  });

  const ado = createAdoService({
    connections,
    settings,
    log: log.child('ado'),
    onUnauthorized: (connectionId) => void late.credentialFailures?.adoUnauthorized(connectionId),
    // AL-232: a PR in a repo that isn't registered here is flagged, so its drop asks to add the repo.
    registeredRemotes: () => readRegisteredRemotes(settings.get().repos, git.run),
  });

  const sessions = createSessionManager({
    claude,
    connections,
    tickets,
    emit: options.emit,
    log: log.child('agent'),
    // Each session gets the `agent_lanes` stage server and protocol (AL-103); `stages` is created below.
    // Then the work item's Azure DevOps MCP server and the user's MCP servers (AL-108), the permission
    // policy (AL-109), the WorktreeCreate / WorktreeRemove hooks that give writer sub-agents their own
    // worktrees (AL-084) and the SubagentStart / SubagentStop hooks of sub-agent tracking (AL-107).
    extras: (record) => sessionExtras(record),
    onEnded: (ticketId, state, info) => {
      // A gate still waiting when its session ends closes, so nothing keeps the card amber (AL-104).
      stages.cancelGate(ticketId);
      // The ended session's servers leave the header pill (AL-108).
      void mcpStatus.refresh();
      // Permission requests the session left waiting close (AL-109).
      permissions.cancelAll(ticketId);
      // A lost session is resumed once in the same worktree, then the user is asked (AL-110).
      recovery.onEnded(ticketId, state, info);
      // The ended session's slot goes to the oldest queued launch of its repo (AL-111).
      void launches.refresh();
    },
    // A silent session is lost only while nobody is asked anything (AL-110).
    isWaitingOnUser: (ticketId) => stages.pendingGate(ticketId) !== null || permissions.pending(ticketId) !== null,
  });
  const transcripts = createTranscriptService({
    sessions,
    tickets,
    emit: options.emit,
    // Output from before a restart is read back from the saved session (AL-102).
    history: async (sessionId, dir) => (await loadClaudeSdk()).getSessionMessages(sessionId, { dir }),
    log: log.child('agent'),
  });
  const stageComments = createStageComments({
    tickets,
    settings,
    writeBack: ado.writeBack,
    orgFor: (orgUrl) => adoConnectionIdFor(connections, orgUrl),
    log: log.child('ado'),
  });
  const stages = createStageService({
    tickets,
    emit: options.emit,
    transcripts,
    log: log.child('agent'),
    // Each lane change posts one comment to the work item (AL-115).
    onStageChanged: (change) => stageComments.stageChanged(change),
  });
  const subagents = createSubagentTracker({ sessions, emit: options.emit, log: log.child('agent') });
  late.subagents = subagents;
  const mergeSubBranches = createMergeSubBranchesService({
    git,
    tickets,
    branches,
    sessions,
    openPath: (path) => shell.openPath(path),
    queue: repoQueue,
    log: log.child('merge'),
  });
  const recovery = createSessionRecovery({ sessions, restart: (ticketId, onStarted) => launches.restart(ticketId, onStarted), emit: options.emit, log: log.child('agent') });
  const launches = createLaunchQueue({
    sessions,
    tickets,
    // The repo's `maxConcurrentAgents` (default 3, Q5), read at each decision.
    maxAgents: (repo) => settings.get().repos.find((item) => item.path === repo)?.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT_AGENTS,
    emit: options.emit,
    log: log.child('agent'),
  });
  const stageExtras = stageSessionExtras({ stages, createServer: sdkStageServer(loadClaudeSdk) });
  const usage = createUsageService({ sessions, emit: options.emit, log: log.child('agent') });
  const skills = createSkillDiscovery({ claude, connections, settings, log: log.child('skills') });
  const permissions = createPermissionService({ settings, buildCommands, emit: options.emit, transcripts, log: log.child('agent') });
  const sessionExtras = combineSessionExtras([
    stageExtras,
    mcpSessionExtras({ connections, log: log.child('agent') }),
    permissions.sessionExtras,
    (record) => ({ hooks: subWorktreeHooks(subWorktrees, record.id, log.child('worktrees'), (sub) => subagents.noteSubBranch(record.id, sub)) }),
    (record) => ({ hooks: subagents.hooks(record.id) }),
  ]);
  const mcpStatus = createMcpStatusMonitor({ sessions, emit: options.emit, log: log.child('agent') });
  const credentialFailureService = createCredentialFailureService({ connections, sessions, tickets, emit: options.emit, log: log.child('credentials') });
  late.credentialFailures = credentialFailureService;
  const buildContext = createBuildContext({ sessions, log: log.child('agent') });

  return {
    appDataDir: options.appDataDir,
    secrets,
    emit: options.emit,
    settings,
    buildQueue,
    buildCommands,
    builds,
    runs,
    git,
    log,
    diagnostics,
    connections,
    designView,
    designCanvases,
    designArtboards,
    designThreads,
    ado,
    tickets,
    repos,
    claude,
    worktrees,
    sessions,
    transcripts,
    stages,
    usage,
    skills,
    mcpStatus,
    permissions,
    recovery,
    launches,
    branches,
    mergeToMain,
    ticketArchive,
    archive,
    diffs,
    reconcile,
    subWorktrees,
    subagents,
    mergeSubBranches,
    credentialFailures: credentialFailureService,
  };
}

/** Stops every child process the app started and flushes state on quit (AL-213, design §10). */
export async function disposeServices(services: Services): Promise<void> {
  // First, so each claude process is closed and its session id is already saved (AL-100).
  await services.sessions.dispose();
  // Then any other claude still open: a design artboard read, a login check or a connection test (AL-213).
  services.claude.closeAll();
  services.mcpStatus.dispose();
  services.transcripts.dispose();
  services.credentialFailures.dispose();
  services.subagents.dispose();
  services.usage.dispose();
  // Closing the app stops every run it started (design §10, AL-134), then aborts queued and running builds.
  await services.runs.dispose();
  await services.buildQueue.dispose();
  // After the queue, so a build that finished while stopping is still saved to its ticket.
  await services.tickets.dispose();
  // Stops the design sessions and finishes writing their threads (AL-196).
  await services.designThreads.dispose();
  // Closes the canvas views and flushes the claude.ai sign-in cookies to disk (D112).
  await services.designView.dispose();
}
