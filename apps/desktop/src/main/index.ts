import { join } from 'node:path';
import { BrowserWindow, app, shell } from 'electron';
import { color } from '@agent-lanes/tokens';
import { createInvokeHandlers } from './ipc/handlers';
import { registerInvokeHandlers, type RendererLocation } from './ipc/router';

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
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    registerInvokeHandlers(createInvokeHandlers(), renderer);
    mainWindow = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
