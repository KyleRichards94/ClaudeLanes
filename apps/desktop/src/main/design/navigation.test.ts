import { describe, expect, it } from 'vitest';
import { createDesignNavigationPolicy, isExternalWebUrl } from './navigation';

const policy = createDesignNavigationPolicy();

describe('design navigation allow-list', () => {
  it('allows claude.ai canvases and its sign-in hosts over https', () => {
    expect(policy.isAllowed('https://claude.ai/design/p/abc123')).toBe(true);
    expect(policy.isAllowed('https://claude.ai/artifact/abc')).toBe(true);
    expect(policy.isAllowed('https://claude.ai/login?returnTo=%2Fdesign')).toBe(true);
    expect(policy.isAllowed('https://accounts.google.com/o/oauth2/auth')).toBe(true);
    expect(policy.isAllowed('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true);
    expect(policy.isAllowed('https://acme.okta.com/app/sso')).toBe(true);
  });

  it('refuses other hosts, look-alikes, plain http, other ports and other schemes', () => {
    for (const url of [
      'https://example.com/',
      'https://claude.ai.evil.com/design',
      'https://evilclaude.ai/',
      'https://evilokta.com/',
      'https://okta.com/',
      'http://claude.ai/design/p/abc',
      'https://claude.ai:8443/design/p/abc',
      'https://user:pass@claude.ai/design/p/abc',
      'file:///C:/Apps/Agent%20Lanes/out/renderer/index.html',
      'http://localhost:5173/',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(policy.isAllowed(url), url).toBe(false);
    }
  });

  it('treats an extra origin exactly like claude.ai, and nothing else on that host', () => {
    const test = createDesignNavigationPolicy({ claudeOrigins: ['http://127.0.0.1:4100'] });
    expect(test.isAllowed('http://127.0.0.1:4100/design/p/canvas')).toBe(true);
    expect(test.isSignInPage('http://127.0.0.1:4100/login')).toBe(true);
    expect(test.isAllowed('http://127.0.0.1:4101/design/p/canvas')).toBe(false);
    expect(policy.isAllowed('http://127.0.0.1:4100/design/p/canvas')).toBe(false);
  });
});

describe('design sign-in detection', () => {
  it('sees claude.ai sign-in pages and identity providers as signed out', () => {
    expect(policy.isSignInPage('https://claude.ai/login')).toBe(true);
    expect(policy.isSignInPage('https://claude.ai/login?returnTo=%2Fdesign%2Fp%2Fabc')).toBe(true);
    expect(policy.isSignInPage('https://claude.ai/magic-link#token')).toBe(true);
    expect(policy.isSignInPage('https://accounts.google.com/signin')).toBe(true);
  });

  it('sees canvas pages as signed in', () => {
    expect(policy.isSignInPage('https://claude.ai/design/p/abc')).toBe(false);
    expect(policy.isSignInPage('https://claude.ai/loginhelp')).toBe(false);
  });
});

describe('design public URL', () => {
  it('keeps a canvas URL whole so the artboard can be reopened', () => {
    expect(policy.publicUrl('https://claude.ai/design/p/abc?board=2#zoom')).toBe('https://claude.ai/design/p/abc?board=2#zoom');
  });

  it('drops query and fragment on sign-in pages, which can carry sign-in tokens', () => {
    expect(policy.publicUrl('https://claude.ai/magic-link#one-time-token')).toBe('https://claude.ai/magic-link');
    expect(policy.publicUrl('https://accounts.google.com/o/oauth2/auth?code=abc')).toBe('https://accounts.google.com/o/oauth2/auth');
  });

  it('reports nothing for pages outside the allow-list', () => {
    expect(policy.publicUrl('https://example.com/?q=1')).toBeNull();
  });
});

describe('external links', () => {
  it('hands only https links to the OS browser', () => {
    expect(isExternalWebUrl('https://docs.anthropic.com/')).toBe(true);
    expect(isExternalWebUrl('http://example.com/')).toBe(false);
    expect(isExternalWebUrl('file:///C:/Windows/system32/calc.exe')).toBe(false);
    expect(isExternalWebUrl('ms-settings:privacy')).toBe(false);
  });
});
