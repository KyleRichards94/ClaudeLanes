import { describe, expect, it } from 'vitest';
import { isInsecureOrgUrl, isTrustedTarget, normalizeOrgUrl } from './org-url';
import { adoPath } from './path';

describe('normalizeOrgUrl', () => {
  it.each([
    ['https://dev.azure.com/contoso', 'https://dev.azure.com/contoso'],
    ['  https://dev.azure.com/contoso/  ', 'https://dev.azure.com/contoso'],
    ['https://DEV.AZURE.COM/Contoso//', 'https://dev.azure.com/Contoso'],
    ['https://Contoso.VisualStudio.com/', 'https://contoso.visualstudio.com'],
    ['https://tfs.example.local/tfs/DefaultCollection', 'https://tfs.example.local/tfs/DefaultCollection'],
    ['http://localhost:8080/tfs/DefaultCollection', 'http://localhost:8080/tfs/DefaultCollection'],
    // Azure DevOps Server on an internal network without TLS.
    ['http://devops:8090/CompanionSystems', 'http://devops:8090/CompanionSystems'],
    ['http://tfs.example.local/tfs/', 'http://tfs.example.local/tfs'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeOrgUrl(input)).toEqual({ ok: true, data: expected });
  });

  it.each([
    'dev.azure.com/contoso',
    '',
    'ftp://dev.azure.com/contoso',
    'http://dev.azure.com/contoso',
    'http://contoso.visualstudio.com',
    'http://user:secret@devops:8090/CompanionSystems',
    'https://user:secret@dev.azure.com/contoso',
    'https://dev.azure.com/contoso?x=1',
    'https://dev.azure.com/contoso#frag',
    'https://dev.azure.com',
    'https://dev.azure.com/contoso/project',
  ])('refuses %j', (input) => {
    expect(normalizeOrgUrl(input)).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});

describe('isTrustedTarget', () => {
  const cloud = new URL('https://dev.azure.com/contoso');
  const legacy = new URL('https://contoso.visualstudio.com');
  const onPrem = new URL('https://tfs.example.local/tfs/DefaultCollection');
  const httpServer = new URL('http://devops:8090/CompanionSystems');

  it.each([
    [cloud, 'https://dev.azure.com/contoso/_apis/projects', true],
    [cloud, 'https://vssps.dev.azure.com/contoso/_apis/profile', true],
    [cloud, 'https://contoso.visualstudio.com/_apis/projects', true],
    [legacy, 'https://contoso.vssps.visualstudio.com/_apis/profile', true],
    [onPrem, 'https://tfs.example.local/tfs/Other/_apis/projects', true],
    [cloud, 'http://dev.azure.com/contoso/_apis/projects', false],
    [cloud, 'https://dev.azure.com.evil.example/contoso', false],
    [cloud, 'https://evilvisualstudio.com/x', false],
    [cloud, 'https://u:p@dev.azure.com/contoso', false],
    [onPrem, 'https://dev.azure.com/contoso', false],
    [httpServer, 'http://devops:8090/CompanionSystems/_apis/projects', true],
    [httpServer, 'http://other-host:8090/CompanionSystems/_apis/projects', false],
    [httpServer, 'https://dev.azure.com/contoso', false],
  ])('%s → %s: %s', (org, target, expected) => {
    expect(isTrustedTarget(new URL(target), org)).toBe(expected);
  });
});

describe('isInsecureOrgUrl', () => {
  it('flags http organisations only', () => {
    expect(isInsecureOrgUrl('http://devops:8090/CompanionSystems')).toBe(true);
    expect(isInsecureOrgUrl('https://dev.azure.com/contoso')).toBe(false);
    expect(isInsecureOrgUrl('not a url')).toBe(false);
  });
});

describe('adoPath', () => {
  it('encodes each value as one segment', () => {
    expect(adoPath`/${'Onsite Companion'}/${'Web/UI'}/_apis/wit/workitems/${71273}`).toBe('/Onsite%20Companion/Web%2FUI/_apis/wit/workitems/71273');
    expect(adoPath`/_apis/projects`).toBe('/_apis/projects');
    expect(adoPath`/${'a?b#c'}/x`).toBe('/a%3Fb%23c/x');
  });
});
