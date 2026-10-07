import type { AdoScopeCheck } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { applyScopeEvidence, sameScopeChecks, scopeEvidence, type AdoResponseNote } from './ado-scopes';

const ORG = 'https://dev.azure.com/CompanionSystems';
const COMMENT: Omit<AdoResponseNote, 'status' | 'level'> = { method: 'POST', url: `${ORG}/OnSite%20Companion/_apis/wit/workItems/71273/comments?format=html` };
const READ_ITEMS: Omit<AdoResponseNote, 'status' | 'level'> = { method: 'GET', url: `${ORG}/_apis/wit/workitems?ids=71273` };

/** What a passing test leaves: reads granted, writes verified on first write. */
const AFTER_TEST: AdoScopeCheck[] = [
  { scope: 'work-items', access: 'read', status: 'granted' },
  { scope: 'work-items', access: 'write', status: 'unverified' },
  { scope: 'code', access: 'read', status: 'granted' },
  { scope: 'code', access: 'write', status: 'unverified' },
  { scope: 'build', access: 'read', status: 'granted' },
];

function statusOf(checks: AdoScopeCheck[], scope: AdoScopeCheck['scope'], access: AdoScopeCheck['access']) {
  return checks.find((check) => check.scope === scope && check.access === access)?.status;
}

describe('scopeEvidence (AL-043)', () => {
  it('a write that worked proves write access', () => {
    expect(scopeEvidence({ ...COMMENT, level: 'debug', status: 200 })).toEqual({ scope: 'work-items', access: 'write', status: 'granted' });
  });

  it('a later 403 on a write marks it missing', () => {
    expect(scopeEvidence({ ...COMMENT, level: 'error', status: 403 })).toEqual({ scope: 'work-items', access: 'write', status: 'missing' });
  });

  it('a sign-in page instead of data counts as missing', () => {
    expect(scopeEvidence({ ...READ_ITEMS, level: 'error', status: 203 })).toMatchObject({ status: 'missing' });
    expect(scopeEvidence({ ...READ_ITEMS, level: 'error', status: 200 })).toMatchObject({ status: 'missing' });
  });

  it('says nothing about a 401 (a bad token, AL-048), other failures, retries or calls outside the scopes', () => {
    expect(scopeEvidence({ ...COMMENT, level: 'error', status: 401 })).toBeUndefined();
    expect(scopeEvidence({ ...COMMENT, level: 'error', status: 404 })).toBeUndefined();
    expect(scopeEvidence({ ...COMMENT, level: 'warn', status: 503 })).toBeUndefined();
    expect(scopeEvidence({ ...COMMENT, level: 'error' })).toBeUndefined();
    expect(scopeEvidence({ method: 'GET', url: `${ORG}/_apis/projects`, level: 'debug', status: 200 })).toBeUndefined();
  });
});

describe('applyScopeEvidence', () => {
  it('verifies write access on the first write that works', () => {
    const next = applyScopeEvidence(AFTER_TEST, { scope: 'work-items', access: 'write', status: 'granted' });
    expect(statusOf(next, 'work-items', 'write')).toBe('granted');
    expect(next.filter((check) => check.scope !== 'work-items')).toEqual(AFTER_TEST.filter((check) => check.scope !== 'work-items'));
  });

  it('marks a refused write missing and leaves the read alone', () => {
    const next = applyScopeEvidence(AFTER_TEST, { scope: 'code', access: 'write', status: 'missing' });
    expect(statusOf(next, 'code', 'write')).toBe('missing');
    expect(statusOf(next, 'code', 'read')).toBe('granted');
  });

  it('a write that works proves the read too; a refused read means no write either', () => {
    const untested = applyScopeEvidence([], { scope: 'code', access: 'write', status: 'granted' });
    expect(untested).toHaveLength(5);
    expect(statusOf(untested, 'code', 'read')).toBe('granted');
    expect(statusOf(untested, 'work-items', 'read')).toBe('unverified');

    const refused = applyScopeEvidence(AFTER_TEST, { scope: 'work-items', access: 'read', status: 'missing' });
    expect(statusOf(refused, 'work-items', 'write')).toBe('missing');
  });

  it('a read that works again puts a write missing because of it back to "verified on first write"', () => {
    const refused = applyScopeEvidence(AFTER_TEST, { scope: 'work-items', access: 'read', status: 'missing' });
    const restored = applyScopeEvidence(refused, { scope: 'work-items', access: 'read', status: 'granted' });
    expect(statusOf(restored, 'work-items', 'read')).toBe('granted');
    expect(statusOf(restored, 'work-items', 'write')).toBe('unverified');

    // A write refused on its own stays missing when reads keep working.
    const writeRefused = applyScopeEvidence(AFTER_TEST, { scope: 'work-items', access: 'write', status: 'missing' });
    expect(statusOf(applyScopeEvidence(writeRefused, { scope: 'work-items', access: 'read', status: 'granted' }), 'work-items', 'write')).toBe('missing');
  });

  it('repeats change nothing', () => {
    const once = applyScopeEvidence(AFTER_TEST, { scope: 'build', access: 'read', status: 'granted' });
    expect(sameScopeChecks(once, AFTER_TEST)).toBe(true);
    expect(sameScopeChecks(applyScopeEvidence(AFTER_TEST, { scope: 'build', access: 'read', status: 'missing' }), AFTER_TEST)).toBe(false);
  });
});
