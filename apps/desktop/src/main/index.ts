import { join } from 'node:path';
import { BrowserWindow, app, shell } from 'electron';
import { color } from '@agent-lanes/tokens';
import { createEmitter, type EventFrame } from './ipc/emit';
import { checkGitOnStartup, showGitStartupNotice } from './git';
import { createInvokeHandlers } from './ipc/handlers';
import { registerInvokeHandlers, type RendererLocation } from './ipc/router';
import { LOG_DIRECTORY_NAME, captureConsole, captureProcessErrors, createLogger } from './logging';
import { createServices, disposeServices, type Services } from './services';

const APP_ID = 'au.com.companionsystems.agentlanes';

const renderer: RendererLocation = {
  url: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
  file: join(__dirname, '../renderer/index.html'),
};

// Tests run against a throwaway profile so they never see real connections or collide with a running
// copy over the single-instance lock. Must be set before the lock is requested.
const userDataOverride = process.env['AGENT_LANES_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);

let mainWindow: BrowserWindow | null = null;
let services: Services | null = null;

/** Events go to the main window's top frame only (AL-012); nothing while there is no live window. */
function mainWindowFrame(): EventFrame | undefined {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return undefined;
  return mainWindow.webContents.mainFrame;
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Agent Lanes',
    backgroundColor: color.bg,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // External links open in the user's browser; the app window never navigates away from the renderer.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (renderer.url) {
    void window.loadURL(renderer.url);
  } else {
    void window.loadFile(renderer.file);
  }

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
      designTestOrigin: app.isPackaged ? undefined : process.env['AGENT_LANES_DESIGN_TEST_ORIGIN'],
      // e2e starts a fake `claude` instead of the real one (AL-044); never honoured in the installed app.
      claudeExecutable: app.isPackaged ? undefined : process.env['AGENT_LANES_CLAUDE_EXECUTABLE'],
    });
    registerInvokeHandlers(createInvokeHandlers(services), renderer, log.child('ipc'));
    mainWindow = createMainWindow();
    // AL-080: warn once, without blocking start-up, when git is missing or older than 2.38.
    void checkGitOnStartup(services.git, (notice) => showGitStartupNotice(mainWindow, notice));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Hold the first quit until services have stopped their child processes, then quit for real.
  let disposed = false;
  app.on('before-quit', (event) => {
    if (disposed || !services) return;
    event.preventDefault();
    log.info('Quitting: stopping services');
    void disposeServices(services).finally(() => {
      disposed = true;
      setImmediate(() => app.quit());
    });
  });
}
