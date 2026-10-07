import { BrowserWindow, dialog, type MessageBoxOptions, type OpenDialogOptions } from 'electron';
import type { RepoDialogs } from './registry';

/** Button order of the refused-folder message box. */
export const PICK_AGAIN_BUTTONS = ['Choose another folder…', 'Cancel'] as const;

/**
 * The window the picker is modal to: the focused one (the user just asked for it), else the first
 * visible window. Looked up per call, so services never hold a window (D42).
 */
function defaultParent(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.isVisible()) ?? null;
}

/**
 * Native dialogs for the repo registry (design §8: "Repo paths are picked with a native folder
 * dialog"). `dialog` is read at call time, so e2e tests can stub `showOpenDialog`/`showMessageBox`.
 */
export function createElectronRepoDialogs(parent: () => BrowserWindow | null = defaultParent): RepoDialogs {
  return {
    async pickFolder({ defaultPath }) {
      const options: OpenDialogOptions = {
        title: 'Add a repo',
        buttonLabel: 'Add repo',
        properties: ['openDirectory', 'dontAddToRecent'],
        ...(defaultPath ? { defaultPath } : {}),
      };
      const window = parent();
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      if (picked.canceled) return null;
      return picked.filePaths[0] ?? null;
    },

    async showProblem(notice) {
      const options: MessageBoxOptions = {
        type: 'error',
        title: notice.title,
        message: notice.message,
        detail: notice.detail,
        buttons: [...PICK_AGAIN_BUTTONS],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const window = parent();
      const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      return response === 0 ? 'pick-again' : 'cancel';
    },
  };
}
