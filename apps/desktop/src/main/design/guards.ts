import { isExternalWebUrl, type DesignNavigationPolicy } from './navigation';

/**
 * Navigation and popup rules for the Claude Design view and the sign-in popups it opens (AL-191, D114).
 * Written against the few WebContents members it uses so main tests can drive it with a fake.
 */

export interface NavigationEvent {
  readonly url: string;
  readonly isMainFrame: boolean;
  preventDefault(): void;
}

export type WindowOpenResponse =
  | { action: 'deny' }
  | {
      action: 'allow';
      overrideBrowserWindowOptions: {
        width: number;
        height: number;
        autoHideMenuBar: boolean;
        webPreferences: PopupWebPreferences;
      };
    };

export interface PopupWebPreferences {
  partition: string;
  sandbox: true;
  contextIsolation: true;
  nodeIntegration: false;
  nodeIntegrationInSubFrames: false;
  webviewTag: false;
}

export interface GuardableContents {
  on(event: 'will-navigate' | 'will-redirect', listener: (event: NavigationEvent) => void): unknown;
  on(event: 'will-attach-webview', listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: 'did-create-window', listener: (window: { webContents: GuardableContents }) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResponse): void;
}

export interface DesignGuardOptions {
  policy: DesignNavigationPolicy;
  /** The session partition sign-in popups share with the view, so their cookies reach it (D112, D114). */
  partition: string;
  /** Hands a link to the OS browser (`shell.openExternal`). */
  openExternal: (url: string) => void;
}

/** Web preferences for every page in the design partition: no preload, no Node, sandboxed (D111). */
export function designWebPreferences(partition: string): PopupWebPreferences {
  return {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
  };
}

/**
 * - Top-level navigation stays on claude.ai and its sign-in hosts; a link elsewhere opens in the OS
 *   browser instead, and a redirect elsewhere is stopped.
 * - `window.open` to claude.ai or a sign-in host opens a child window in the same partition (guarded the
 *   same way); any other https popup goes to the OS browser; everything else is dropped.
 * - `<webview>` tags are refused.
 */
export function attachDesignGuards(contents: GuardableContents, options: DesignGuardOptions): void {
  const { policy, openExternal } = options;

  contents.on('will-navigate', (event) => {
    if (!event.isMainFrame || policy.isAllowed(event.url)) return;
    event.preventDefault();
    if (isExternalWebUrl(event.url)) openExternal(event.url);
  });

  contents.on('will-redirect', (event) => {
    if (!event.isMainFrame || policy.isAllowed(event.url)) return;
    event.preventDefault();
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());

  contents.setWindowOpenHandler(({ url }) => {
    if (policy.isAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: designWebPreferences(options.partition),
        },
      };
    }
    if (isExternalWebUrl(url)) openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-create-window', (window) => attachDesignGuards(window.webContents, options));
}

/**
 * Permissions a claude.ai page may have: writing to the clipboard (copy buttons) and full screen.
 * Everything else (camera, microphone, notifications, location, …) is denied; Electron grants all by default.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

export function isDesignPermissionAllowed(permission: string, requestingUrl: string, policy: DesignNavigationPolicy): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && policy.isAllowed(requestingUrl);
}
