import { dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron';
import type { GitStartupNotice } from './startup-check';

/** Shows the start-up git warning as a native dialog over the main window, once it is visible. */
export async function showGitStartupNotice(window: BrowserWindow | null, notice: GitStartupNotice): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'warning',
    title: notice.title,
    message: notice.message,
    detail: notice.detail,
    buttons: ['Get Git', 'Close'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };

  const parent = window && !window.isDestroyed() ? window : null;
  if (parent && !parent.isVisible()) {
    await new Promise<void>((resolve) => parent.once('show', () => resolve()));
  }

  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response === 0) await shell.openExternal(notice.downloadUrl);
}
