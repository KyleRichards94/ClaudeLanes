import { WebContentsView, session, shell, type BrowserWindow, type Session } from 'electron';
import { attachDesignGuards, designWebPreferences, isDesignPermissionAllowed, type GuardableContents } from './guards';
import { isExternalWebUrl, type DesignNavigationPolicy } from './navigation';
import type { DesignHostWindow, DesignViewHandle, DesignViewPlatform } from './view-service';

/** The claude.ai sign-in lives here, apart from the app's own session, and persists across restarts (D111, D112). */
export const DESIGN_PARTITION = 'persist:claude-design';

/** Chromium's net::ERR_ABORTED: a navigation replaced or stopped (also by the guards), not a failure. */
const ERR_ABORTED = -3;

export interface ElectronDesignPlatformOptions {
  /** The main window, read on every open. */
  window: () => BrowserWindow | null | undefined;
  policy: DesignNavigationPolicy;
}

/**
 * Electron side of the design view service: `WebContentsView`s in the `persist:claude-design`
 * partition with no preload, sandboxed and context-isolated, so a canvas page has no app bridge, no
 * Node and no way to call an app channel (the invoke router also refuses any frame that is not the
 * renderer, AL-011). No custom user agent (D113).
 */
export function createElectronDesignPlatform(options: ElectronDesignPlatformOptions): DesignViewPlatform {
  const { policy } = options;
  const views = new WeakMap<DesignViewHandle, WebContentsView>();
  const hosts = new WeakMap<BrowserWindow, DesignHostWindow>();
  let configured: Session | undefined;

  function openExternal(url: string): void {
    if (isExternalWebUrl(url)) void shell.openExternal(url).catch(() => undefined);
  }

  function designSession(): Session {
    if (configured) return configured;
    const designSession = session.fromPartition(DESIGN_PARTITION);
    designSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(isDesignPermissionAllowed(permission, details.requestingUrl, policy));
    });
    designSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      isDesignPermissionAllowed(permission, requestingOrigin, policy),
    );
    configured = designSession;
    return designSession;
  }

  function viewOf(handle: DesignViewHandle): WebContentsView {
    const view = views.get(handle);
    if (!view) throw new Error('Unknown design view');
    return view;
  }

  function hostFor(window: BrowserWindow): DesignHostWindow {
    const existing = hosts.get(window);
    if (existing) return existing;
    const host: DesignHostWindow = {
      add(handle) {
        if (!window.isDestroyed()) window.contentView.addChildView(viewOf(handle));
      },
      remove(handle) {
        if (!window.isDestroyed()) window.contentView.removeChildView(viewOf(handle));
      },
      zoomFactor() {
        return window.isDestroyed() ? 1 : window.webContents.getZoomFactor();
      },
    };
    hosts.set(window, host);
    return host;
  }

  return {
    createView(callbacks) {
      designSession();
      const view = new WebContentsView({ webPreferences: designWebPreferences(DESIGN_PARTITION) });
      const contents = view.webContents;
      attachDesignGuards(contents as unknown as GuardableContents, { policy, partition: DESIGN_PARTITION, openExternal });

      contents.on('did-navigate', (_event, url) => callbacks.onNavigated(url));
      contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame) callbacks.onNavigated(url);
      });
      contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
        if (isMainFrame && errorCode !== ERR_ABORTED) callbacks.onLoadFailed();
      });
      contents.on('render-process-gone', () => callbacks.onLoadFailed());

      const handle: DesignViewHandle = {
        webContentsId: contents.id,
        load(url) {
          // Failures are reported through did-fail-load; the promise only repeats them.
          if (!contents.isDestroyed()) void contents.loadURL(url).catch(() => undefined);
        },
        setBounds(rect) {
          view.setBounds(rect);
        },
        setVisible(visible) {
          view.setVisible(visible);
        },
        destroy() {
          if (!contents.isDestroyed()) contents.close();
        },
      };
      views.set(handle, view);
      return handle;
    },

    window() {
      const window = options.window();
      return window && !window.isDestroyed() ? hostFor(window) : undefined;
    },

    async flush() {
      await designSession().cookies.flushStore();
    },
  };
}
