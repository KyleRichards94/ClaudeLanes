import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { attachDesignGuards, isDesignPermissionAllowed, type GuardableContents, type WindowOpenResponse } from './guards';
import { createDesignNavigationPolicy } from './navigation';

const PARTITION = 'persist:claude-design';
const policy = createDesignNavigationPolicy();

class FakeContents extends EventEmitter {
  openHandler: ((details: { url: string }) => WindowOpenResponse) | undefined;
  setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResponse): void {
    this.openHandler = handler;
  }

  navigate(kind: 'will-navigate' | 'will-redirect', url: string, isMainFrame = true): boolean {
    let prevented = false;
    this.emit(kind, { url, isMainFrame, preventDefault: () => (prevented = true) });
    return prevented;
  }
}

function guarded() {
  const contents = new FakeContents();
  const openExternal = vi.fn();
  attachDesignGuards(contents as unknown as GuardableContents, { policy, partition: PARTITION, openExternal });
  return { contents, openExternal };
}

describe('design view guards', () => {
  it('lets the view move around claude.ai and its sign-in hosts', () => {
    const { contents, openExternal } = guarded();
    expect(contents.navigate('will-navigate', 'https://claude.ai/login')).toBe(false);
    expect(contents.navigate('will-navigate', 'https://accounts.google.com/signin')).toBe(false);
    expect(contents.navigate('will-redirect', 'https://claude.ai/design/p/abc')).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('stops a link off the allow-list and opens it in the OS browser instead', () => {
    const { contents, openExternal } = guarded();
    expect(contents.navigate('will-navigate', 'https://docs.anthropic.com/en/docs')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://docs.anthropic.com/en/docs');
  });

  it('never lets the view become the app renderer or a local file', () => {
    const { contents, openExternal } = guarded();
    expect(contents.navigate('will-navigate', 'http://localhost:5173/')).toBe(true);
    expect(contents.navigate('will-navigate', 'file:///C:/Apps/Agent%20Lanes/out/renderer/index.html')).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('stops a redirect off the allow-list without opening it', () => {
    const { contents, openExternal } = guarded();
    expect(contents.navigate('will-redirect', 'https://tracker.example.com/')).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('leaves sub-frames alone (embedded widgets on claude.ai pages)', () => {
    const { contents } = guarded();
    expect(contents.navigate('will-navigate', 'https://challenges.cloudflare.com/x', false)).toBe(false);
  });

  it('opens claude.ai and sign-in popups as sandboxed child windows in the same partition', () => {
    const { contents, openExternal } = guarded();
    const response = contents.openHandler?.({ url: 'https://accounts.google.com/o/oauth2/auth' });
    expect(response).toMatchObject({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    });
    expect(response?.action === 'allow' && 'preload' in response.overrideBrowserWindowOptions.webPreferences).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('sends every other https popup to the OS browser and drops the rest', () => {
    const { contents, openExternal } = guarded();
    expect(contents.openHandler?.({ url: 'https://www.anthropic.com/legal' })).toEqual({ action: 'deny' });
    expect(contents.openHandler?.({ url: 'file:///C:/Windows/system32/calc.exe' })).toEqual({ action: 'deny' });
    expect(openExternal.mock.calls).toEqual([['https://www.anthropic.com/legal']]);
  });

  it('guards the child windows it opens the same way', () => {
    const { contents, openExternal } = guarded();
    const child = new FakeContents();
    contents.emit('did-create-window', { webContents: child });
    expect(child.navigate('will-navigate', 'https://example.com/')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('refuses webview tags', () => {
    const { contents } = guarded();
    let prevented = false;
    contents.emit('will-attach-webview', { preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
  });
});

describe('design view permissions', () => {
  it('allows clipboard writes and full screen for claude.ai only', () => {
    expect(isDesignPermissionAllowed('clipboard-sanitized-write', 'https://claude.ai/design/p/a', policy)).toBe(true);
    expect(isDesignPermissionAllowed('fullscreen', 'https://claude.ai/design/p/a', policy)).toBe(true);
    expect(isDesignPermissionAllowed('clipboard-sanitized-write', 'https://example.com/', policy)).toBe(false);
  });

  it('denies everything else', () => {
    for (const permission of ['media', 'notifications', 'geolocation', 'openExternal', 'clipboard-read', 'hid', 'serial']) {
      expect(isDesignPermissionAllowed(permission, 'https://claude.ai/design/p/a', policy), permission).toBe(false);
    }
  });
});
