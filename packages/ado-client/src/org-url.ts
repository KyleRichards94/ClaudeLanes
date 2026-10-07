import { err, ok, type Result } from '@agent-lanes/contracts';

const CLOUD_SUFFIXES = ['.dev.azure.com', '.visualstudio.com'];

/**
 * Normalises an organisation URL as typed in the Connections modal: `https://dev.azure.com/contoso/`
 * → `https://dev.azure.com/contoso`, `https://Contoso.VisualStudio.com` → `https://contoso.visualstudio.com`.
 * Plain `http` is accepted for Azure DevOps Server (on-premises) collections, which teams often run on
 * an internal network without TLS; the Connections form warns that the PAT then travels unencrypted.
 * Azure DevOps Services only serves https, so `http` to a cloud host is refused, as is a URL carrying
 * a user name or password. Messages never echo the input: a pasted URL may hold a token.
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
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return err('VALIDATION', 'The organisation URL must start with https:// or http://.');
  }
  if (url.protocol === 'http:' && isCloudHost(url.hostname.toLowerCase())) {
    return err('VALIDATION', 'Azure DevOps Services only serves https; use https:// for this organisation.');
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

/** True when the organisation URL sends its token unencrypted (an http on-premises server). */
export function isInsecureOrgUrl(orgUrl: string): boolean {
  try {
    return new URL(orgUrl.trim()).protocol === 'http:';
  } catch {
    return false;
  }
}

/** True for Azure DevOps Services hosts (`dev.azure.com`, `*.dev.azure.com`, `*.visualstudio.com`). */
export function isCloudHost(hostname: string): boolean {
  return hostname === 'dev.azure.com' || CLOUD_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Whether the PAT for `orgUrl` may be sent to `target`. The organisation's own origin is always
 * allowed; a cloud organisation may also reach the other Azure DevOps Services hosts
 * (`vssps.dev.azure.com`, `almsearch.dev.azure.com`, …) that its responses link to. Plain http only
 * ever reaches the organisation's own origin (an http on-premises server), never another host.
 */
export function isTrustedTarget(target: URL, orgUrl: URL): boolean {
  if (target.username !== '' || target.password !== '') return false;
  if (target.origin === orgUrl.origin) return true;
  return target.protocol === 'https:' && isCloudHost(orgUrl.hostname) && isCloudHost(target.hostname);
}
