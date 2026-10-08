import { join } from 'node:path';
import { BrowserWindow, app, dialog, screen, shell } from 'electron';
import { color } from '@agent-lanes/tokens';
import { createQuitConfirmation, quitQuestion, type QuitConfirmation } from './app/quit-confirmation';
import { watchWindowVisibility } from './app/window-visibility';
import { createBacklogWindowController } from './app/backlog-window';
import { MIN_WINDOW_SIZE, currentWindowState, readWindowState, windowPlacement, windowStateFile, writeWindowState } from './app/window-state';
import { createEmitter, type EventFrame } from './ipc/emit';
import { checkGitOnStartup, showGitStartupNotice } from './git';
import { createInvokeHandlers } from './ipc/handlers';
import { registerInvokeHandlers, type RendererLocation } from './ipc/router';
import { LOG_DIRECTORY_NAME, captureConsole, captureProcessErrors, createLogger } from './logging';
import { createServices, disposeServices, type Services } from './services';
import { NO_TEST_HOOKS, testHooksFor } from './test-hooks';

const APP_ID = 'au.com.companionsystems.agentlanes';

const renderer: RendererLocation = {
  url: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
  file: join(__dirname, '../renderer/index.html'),
};

// Tests run against a throwaway profile so they never see real connections or collide with a running
// copy over the single-instance lock. Must be set before the lock is requested.
const userDataOverride = process.env['AGENT_LANES_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);

// The switches e2e swaps fakes in with (AL-222). A release build (`pnpm package`) has none: `__TEST_HOOKS__`
// is false there, so the code that reads them is left out; the installed app never reads them either.
const testHooks = __TEST_HOOKS__ ? testHooksFor({ isPackaged: app.isPackaged, env: process.env }) : NO_TEST_HOOKS;

let mainWindow: BrowserWindow | null = null;
let services: Services | null = null;
let quitConfirmation: QuitConfirmation | null = null;

/** Events go to the main window's top frame only (AL-012); nothing while there is no live window. */
function mainWindowFrame(): EventFrame | undefined {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return undefined;
  return mainWindow.webContents.mainFrame;
}

/** Both windows: the sandboxed preload and nothing else. */
const WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
} as const;

/** External links open in the user's browser; an app window never navigates away from the renderer. */
function keepOnRenderer(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}

/** Loads the renderer, on a route when `hash` is given (`backlog/<team>` for the popped-out Backlog). */
function loadRenderer(window: BrowserWindow, hash?: string): void {
  // e2e opens most specs straight on the board instead of first run (AL-047); never honoured in the installed app.
  const query: Record<string, string> = testHooks.skipFirstRun ? { firstRun: 'skip' } : {};

  if (renderer.url) {
    const url = new URL(renderer.url);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    if (hash) url.hash = `/${hash}`;
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(renderer.file, { query, ...(hash ? { hash: `/${hash}` } : {}) });
  }
}

function createMainWindow(): BrowserWindow {
  // AL-213: the window opens where it was left, or centred when that spot is off every screen now.
  const stateFile = windowStateFile(app.getPath('userData'));
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
  const placement = windowPlacement(readWindowState(stateFile), [primary.workArea, ...others.map((display) => display.workArea)]);
  const window = new BrowserWindow({
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    title: 'Agent Lanes',
    backgroundColor: color.bg,
    autoHideMenuBar: true,
    webPreferences: WEB_PREFERENCES,
  });

  window.once('ready-to-show', () => {
    if (placement.maximized) window.maximize();
    window.show();
  });

  // AL-213: closing while agents are mid-turn asks first; otherwise the size and position are saved.
  window.on('close', (event) => {
    if (quitConfirmation?.hold(() => app.quit())) {
      event.preventDefault();
      return;
    }
    writeWindowState(stateFile, currentWindowState(window), (message) => console.warn(message));
  });
  // The popped-out Backlog goes with the main window, so closing it still quits the app.
  window.on('closed', () => services?.backlogWindow.close());

  keepOnRenderer(window);
  loadRenderer(window);
  return window;
}

/**
 * The popped-out Backlog (AL-239, TB§5): its own window, for a second monitor, beside the main one.
 * Rows dragged from it land on the main window's lanes with native HTML5 drag.
 */
function createBacklogWindow(team: string | undefined): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const bounds = mainWindow.getBounds();
  const window = new BrowserWindow({
    x: bounds.x + 48,
    y: bounds.y + 48,
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Backlog · Agent Lanes',
    backgroundColor: color.bg,
    autoHideMenuBar: true,
    webPreferences: WEB_PREFERENCES,
  });
  window.once('ready-to-show', () => window.show());
  keepOnRenderer(window);
  loadRenderer(window, team ? `backlog/${encodeURIComponent(team)}` : 'backlog');
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // The log comes first, so anything that goes wrong from here on is on disk, redacted (AL-214).
  const log = createLogger({
    directory: join(app.getPath('userData'), LOG_DIRECTORY_NAME),
    level: app.isPackaged ? 'info' : 'debug',
    mirror: app.isPackaged ? undefined : console,
  });
  captureProcessErrors(log);
  captureConsole(log);
  log.info(`${app.getName()} ${app.getVersion()} starting`, {
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  });
  app.on('render-process-gone', (_event, _contents, details) => {
    log.log(details.reason === 'clean-exit' ? 'info' : 'error', 'A renderer process ended', details);
  });
  app.on('child-process-gone', (_event, details) => {
    log.log(details.reason === 'clean-exit' ? 'info' : 'error', `The ${details.type} process ended`, details);
  });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    // Invalid event payloads throw while developing and are logged and dropped in the installed app.
    const eventsLog = log.child('events');
    const emit = createEmitter({
      frame: mainWindowFrame,
      renderer,
      strict: !app.isPackaged,
      log: (message, issues) => eventsLog.error(message, issues),
    });
    services = createServices({
      appDataDir: app.getPath('userData'),
      emit,
      log,
      mainWindow: () => mainWindow,
      // e2e points the design view at a local fake claude.ai (AL-191); never honoured in the installed app.
      designTestOrigin: testHooks.designTestOrigin,
      // e2e starts a fake `claude` instead of the real one (AL-044); never honoured in the installed app.
      claudeExecutable: testHooks.claudeExecutable,
      // AL-239: Pop out opens the Backlog in its own window.
      backlogWindow: createBacklogWindowController(createBacklogWindow),
    });
    registerInvokeHandlers(createInvokeHandlers(services), renderer, log.child('ipc'));
    const sessions = services.sessions;
    quitConfirmation = createQuitConfirmation({
      midTurn: () => sessions.midTurn(),
      async confirm(ticketIds) {
        const question = quitQuestion(ticketIds);
        const options = { type: 'warning' as const, title: 'Quit Agent Lanes?', buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, ...question };
        const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
        const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
        log.info(response === 0 ? 'Quitting with agents mid-turn' : 'Quit cancelled: agents mid-turn', { ticketIds });
        return response === 0;
      },
    });
    mainWindow = createMainWindow();
    // AL-066: the renderer polls Azure DevOps only while the window can be seen.
    watchWindowVisibility(mainWindow, emit);
    // AL-080: warn once, without blocking start-up, when git is missing or older than 2.38.
    void checkGitOnStartup(services.git, (notice) => showGitStartupNotice(mainWindow, notice));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length > 0) return;
      mainWindow = createMainWindow();
      watchWindowVisibility(mainWindow, emit);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Hold the first quit until services have stopped their child processes, then quit for real.
  let disposed = false;
  let disposing = false;
  app.on('before-quit', (event) => {
    if (disposed || !services) return;
    event.preventDefault();
    // A quit from the menu or the taskbar asks first too when agents are mid-turn (AL-213).
    if (quitConfirmation?.hold(() => app.quit())) return;
    if (disposing) return;
    disposing = true;
    log.info('Quitting: stopping services');
    void disposeServices(services).finally(() => {
      disposed = true;
      setImmediate(() => app.quit());
    });
  });
}
