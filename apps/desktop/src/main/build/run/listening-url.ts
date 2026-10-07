import { stripAnsi } from '../log/parse';

/**
 * Finds the address a web app says it listens on (AL-133): ASP.NET's "Now listening on:
 * http://localhost:5080", Vite's "Local:   http://localhost:5173/", Next's "- Local: http://localhost:3000",
 * and any other local `http(s)://` URL with a port. Only local hosts count, so links in help text
 * (https://aka.ms/…) are never taken for the app. Wildcard hosts (`0.0.0.0`, `[::]`, `+`, `*`) become
 * `localhost` so the URL opens in a browser.
 */
const LOCAL_URL = /\b(https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\+|\*)(?::(\d{1,5}))(\/[^\s'"<>)]*)?/i;

export function findListeningUrl(line: string): string | null {
  const match = LOCAL_URL.exec(stripAnsi(line));
  if (!match) return null;
  const [, scheme, host, port, path] = match;
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) return null;
  const hostName = host === '127.0.0.1' || host === '[::1]' ? host : 'localhost';
  const tail = (path ?? '/').replace(/[.,;:]+$/, '') || '/';
  return `${scheme!.toLowerCase()}://${hostName}:${portNumber}${tail}`;
}
