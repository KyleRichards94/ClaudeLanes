/**
 * Where the Claude Design view may go (AL-191, D111–D114). The view shows claude.ai and the pages a
 * claude.ai sign-in passes through; anything else is refused in the view and, for a link the user
 * followed, opened in the OS browser instead.
 */

/** Hosts that are claude.ai itself. The canvas, its chat and claude.ai's own sign-in pages live here. */
const CLAUDE_HOSTS = ['claude.ai'];

/**
 * Identity providers a claude.ai sign-in can pass through. Google is listed for completeness, but
 * Google refuses sign-in in embedded browsers (D113). Enterprise SSO providers on their own domains
 * need adding here when a team uses one (AL-190 open item).
 */
const AUTH_HOSTS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  '*.okta.com',
  '*.workos.com',
];

/** claude.ai paths that mean "not signed in" (a sign-in redirect lands on one of these). */
const SIGN_IN_PATH = /^\/(?:login|logout|signup|sso|magic-link|auth)(?:[/?#]|$)/i;

export interface DesignNavigationPolicy {
  /** True when the view (or a sign-in popup in its partition) may show this URL. */
  isAllowed(url: string): boolean;
  /** True for claude.ai sign-in pages and identity-provider pages: the view is not signed in. */
  isSignInPage(url: string): boolean;
  /**
   * The URL as the renderer may see it: unchanged on canvas pages, origin and path only on sign-in and
   * identity-provider pages, whose query and fragment can carry one-time sign-in tokens.
   */
  publicUrl(url: string): string | null;
}

export interface DesignNavigationOptions {
  /**
   * Extra origins treated as claude.ai, exact match (scheme, host and port). Only the e2e fake site
   * uses this, through `AGENT_LANES_DESIGN_TEST_ORIGIN` in an unpackaged build.
   */
  claudeOrigins?: readonly string[];
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function hostMatches(host: string, patterns: readonly string[]): boolean {
  const lower = host.toLowerCase();
  // `*.okta.com` matches any subdomain (`acme.okta.com`) but not `okta.com` or `evilokta.com`.
  return patterns.some((pattern) => (pattern.startsWith('*.') ? lower.endsWith(pattern.slice(1)) : lower === pattern));
}

export function createDesignNavigationPolicy(options: DesignNavigationOptions = {}): DesignNavigationPolicy {
  const extraOrigins = new Set(
    (options.claudeOrigins ?? []).map((origin) => parse(origin)?.origin).filter((origin): origin is string => !!origin),
  );

  function isClaude(url: URL): boolean {
    if (extraOrigins.has(url.origin)) return true;
    return url.protocol === 'https:' && url.port === '' && hostMatches(url.hostname, CLAUDE_HOSTS);
  }

  function isAuthProvider(url: URL): boolean {
    return url.protocol === 'https:' && url.port === '' && hostMatches(url.hostname, AUTH_HOSTS);
  }

  function isSignIn(url: URL): boolean {
    return isAuthProvider(url) || (isClaude(url) && SIGN_IN_PATH.test(url.pathname));
  }

  return {
    isAllowed(raw) {
      const url = parse(raw);
      if (!url || url.username || url.password) return false;
      return isClaude(url) || isAuthProvider(url);
    },
    isSignInPage(raw) {
      const url = parse(raw);
      return !!url && isSignIn(url);
    },
    publicUrl(raw) {
      const url = parse(raw);
      if (!url || !(isClaude(url) || isAuthProvider(url))) return null;
      return isSignIn(url) ? `${url.origin}${url.pathname}` : url.href;
    },
  };
}

/** Links the view may hand to the OS browser: web pages only, never file:, custom schemes or javascript:. */
export function isExternalWebUrl(raw: string): boolean {
  const url = parse(raw);
  return !!url && url.protocol === 'https:';
}
