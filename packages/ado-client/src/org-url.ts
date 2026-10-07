import { err, ok, type Result } from '@agent-lanes/contracts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const CLOUD_SUFFIXES = ['.dev.azure.com', '.visualstudio.com'];

/**
 * Normalises an organisation URL as typed in the Connections modal: `https://dev.azure.com/contoso/`
 * → `https://dev.azure.com/contoso`, `https://Contoso.VisualStudio.com` → `https://contoso.visualstudio.com`.
 * The PAT travels with every request, so plain `http` is refused (except loopback for local servers),
 * as is a URL carrying a user name or password. Messages never echo the input: a pasted URL may hold a token.
 */
export function normalizeOrgUrl(input: string): Result<string> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return err('VALIDATION', 'The organisation URL is not a valid URL, e.g. https://dev.azure.com/contoso.');
  }

  if (url.username !== '' || url.password !== '') {
    return err('VALIDATION', 'The organisation URL must not contain a user name or password; put the token in the PAT field.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    return err('VALIDATION', 'The organisation URL must use https so the token is never sent in clear text.');
  }
  if (url.search !== '' || url.hash !== '') {
    return err('VALIDATION', 'The organisation URL must not contain a query string or fragment.');
  }

  const path = url.pathname.replace(/\/+$/, '');
  if (url.hostname === 'dev.azure.com' && path.split('/').filter(Boolean).length !== 1) {
    return err('VALIDATION', 'A dev.azure.com URL must name exactly one organisation, e.g. https://dev.azure.com/contoso.');
  }
  return ok(`${url.origin}${path}`);
}

/** True for Azure DevOps Services hosts (`dev.azure.com`, `*.dev.azure.com`, `*.visualstudio.com`). */
export function isCloudHost(hostname: string): boolean {
  return hostname === 'dev.azure.com' || CLOUD_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Whether the PAT for `orgUrl` may be sent to `target`. The organisation's own origin is always
 * allowed; a cloud organisation may also reach the other Azure DevOps Services hosts
 * (`vssps.dev.azure.com`, `almsearch.dev.azure.com`, …) that its responses link to. Never plain http
 * unless the organisation itself is a loopback server.
 */
export function isTrustedTarget(target: URL, orgUrl: URL): boolean {
  if (target.username !== '' || target.password !== '') return false;
  if (target.origin === orgUrl.origin) return true;
  return target.protocol === 'https:' && isCloudHost(orgUrl.hostname) && isCloudHost(target.hostname);
}
