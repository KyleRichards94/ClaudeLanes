import { pathToFileURL } from 'node:url';

/**
 * IPC is only answered for frames showing our own renderer: the Vite dev server in
 * development, or the bundled index.html when packaged. Any other frame (a navigated
 * window, the Claude Design view) is refused.
 */
export function isTrustedSenderUrl(frameUrl: string | undefined, rendererUrl: string | undefined, rendererFile: string): boolean {
  if (!frameUrl) return false;

  let url: URL;
  try {
    url = new URL(frameUrl);
  } catch {
    return false;
  }

  if (rendererUrl) {
    return url.origin === new URL(rendererUrl).origin;
  }

  const expected = pathToFileURL(rendererFile);
  return url.protocol === 'file:' && decodeURIComponent(url.pathname) === decodeURIComponent(expected.pathname);
}
