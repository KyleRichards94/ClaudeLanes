import { describe, expect, it } from 'vitest';
import {
  ADO_SCOPE_LABELS,
  adoScopeChips,
  adoScopeRequirement,
  displayOrgUrl,
  formatAdoConnectionDetails,
  formatTokenExpiry,
  TOKEN_EXPIRY_WARNING_DAYS,
  tokenExpiryState,
} from './connections.display';
import { MASKED_TOKEN_BULLETS, type AdoScopeCheck } from './connections.schemas';

/** 7 Oct 2026, mid-morning, on the user's own clock: the day artboard 1's sprint starts. */
const NOW = new Date(2026, 9, 7, 10, 30);

const savedRow = {
  orgUrl: 'https://dev.azure.com/CompanionSystems',
  identity: 'Kyle Richards',
  maskedToken: `${MASKED_TOKEN_BULLETS}7Fq2`,
  expiresAt: '2027-01-12',
};

describe('the saved ADO row (AL-043, artboard 5)', () => {
  it('reads "url · signed in as <name> · token <masked> · expires <date>"', () => {
    expect(formatAdoConnectionDetails(savedRow, NOW)).toBe(
      'dev.azure.com/CompanionSystems · signed in as Kyle Richards · token ••••••••7Fq2 · expires 12 Jan',
    );
  });

  it('leaves out what is not known', () => {
    expect(formatAdoConnectionDetails({ ...savedRow, identity: null, expiresAt: null }, NOW)).toBe('dev.azure.com/CompanionSystems · token ••••••••7Fq2');
    expect(formatAdoConnectionDetails({ ...savedRow, maskedToken: null }, NOW)).toBe(
      'dev.azure.com/CompanionSystems · signed in as Kyle Richards · expires 12 Jan',
    );
  });

  it('shows organisation URLs without the scheme', () => {
    expect(displayOrgUrl('https://contoso.visualstudio.com')).toBe('contoso.visualstudio.com');
    expect(displayOrgUrl('https://tfs.example.com/tfs/DefaultCollection/')).toBe('tfs.example.com/tfs/DefaultCollection');
    expect(displayOrgUrl('http://127.0.0.1:8080/contoso')).toBe('127.0.0.1:8080/contoso');
  });
});

describe('token expiry (Q10)', () => {
  it('is unknown without a date: ADO does not tell a PAT its own expiry', () => {
    expect(tokenExpiryState(null, NOW)).toBe('unknown');
    expect(tokenExpiryState(undefined, NOW)).toBe('unknown');
    expect(formatTokenExpiry(null, NOW)).toBeNull();
  });

  it(`warns from ${TOKEN_EXPIRY_WARNING_DAYS} days before, through the day itself, then shows expired`, () => {
    expect(tokenExpiryState('2026-10-15', NOW)).toBe('ok');
    expect(tokenExpiryState('2026-10-14', NOW)).toBe('soon');
    expect(tokenExpiryState('2026-10-07', NOW)).toBe('soon');
    expect(tokenExpiryState('2026-10-06', NOW)).toBe('expired');
  });

  it('uses the local calendar day, whatever the time', () => {
    expect(tokenExpiryState('2026-10-07', new Date(2026, 9, 7, 23, 59))).toBe('soon');
    expect(tokenExpiryState('2026-10-07', new Date(2026, 9, 8, 0, 1))).toBe('expired');
  });

  it('formats like the design: "expires 12 Jan", with the year only when it is far off', () => {
    expect(formatTokenExpiry('2027-01-12', NOW)).toBe('expires 12 Jan');
    expect(formatTokenExpiry('2026-12-31', NOW)).toBe('expires 31 Dec');
    expect(formatTokenExpiry('2027-10-01', NOW)).toBe('expires 1 Oct 2027');
    expect(formatTokenExpiry('2026-10-07', NOW)).toBe('expires today');
    expect(formatTokenExpiry('2026-10-02', NOW)).toBe('expired 2 Oct');
    expect(formatTokenExpiry('2025-01-02', NOW)).toBe('expired 2 Jan 2025');
  });

  it('ignores a date that is not a real ISO date', () => {
    expect(tokenExpiryState('2027-02-30', NOW)).toBe('unknown');
    expect(formatTokenExpiry('12/01/2027', NOW)).toBeNull();
  });
});

describe('scope chips', () => {
  const tested = (build: AdoScopeCheck['status']): AdoScopeCheck[] => [
    { scope: 'work-items', access: 'read', status: 'granted' },
    { scope: 'work-items', access: 'write', status: 'unverified' },
    { scope: 'code', access: 'read', status: 'granted' },
    { scope: 'code', access: 'write', status: 'granted' },
    { scope: 'build', access: 'read', status: build },
  ];

  it('are Work Items, Code and Build, untested before a test', () => {
    expect(adoScopeChips([])).toEqual([
      { scope: 'work-items', label: 'Work Items', state: 'untested', detail: 'needs read & write' },
      { scope: 'code', label: 'Code', state: 'untested', detail: 'needs read & write' },
      { scope: 'build', label: 'Build', state: 'untested', detail: 'needs read' },
    ]);
  });

  it('a PAT without Build (read) shows the Build chip as missing', () => {
    expect(adoScopeChips(tested('missing'))).toEqual([
      { scope: 'work-items', label: 'Work Items', state: 'granted', detail: 'read ok · write verified on first write' },
      { scope: 'code', label: 'Code', state: 'granted', detail: 'read ok · write ok' },
      { scope: 'build', label: 'Build', state: 'missing', detail: 'read missing' },
    ]);
  });

  it('a read that could not be checked is unverified', () => {
    expect(adoScopeChips(tested('unverified'))[2]).toEqual({ scope: 'build', label: 'Build', state: 'unverified', detail: 'read not checked' });
  });

  it('a refused write marks the chip missing even though reading works', () => {
    const checks = tested('granted').map((check): AdoScopeCheck => (check.scope === 'work-items' && check.access === 'write' ? { ...check, status: 'missing' } : check));
    expect(adoScopeChips(checks)[0]).toMatchObject({ state: 'missing', detail: 'read ok · write missing' });
  });

  it('labels each area with what it needs', () => {
    expect(Object.values(ADO_SCOPE_LABELS)).toEqual(['Work Items', 'Code', 'Build']);
    expect(adoScopeRequirement('work-items')).toBe('Work Items (read & write)');
    expect(adoScopeRequirement('code')).toBe('Code (read & write)');
    expect(adoScopeRequirement('build')).toBe('Build (read)');
  });
});
