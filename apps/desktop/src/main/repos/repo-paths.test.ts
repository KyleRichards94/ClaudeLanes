import { describe, expect, it } from 'vitest';
import { isSameRepoPath, repoPathKey } from './repo-paths';

describe('repo paths', () => {
  it('ignores case, slash direction and a trailing separator on Windows', () => {
    expect(isSameRepoPath('C:\\Src\\OnSite-Companion', 'c:/src/onsite-companion/', 'win32')).toBe(true);
    expect(isSameRepoPath('C:\\src\\a', 'C:\\src\\b', 'win32')).toBe(false);
  });

  it('keeps case on Linux', () => {
    expect(isSameRepoPath('/src/App', '/src/app', 'linux')).toBe(false);
    expect(isSameRepoPath('/src/app/', '/src/app', 'linux')).toBe(true);
  });

  it('keeps the separator of a drive or file-system root', () => {
    expect(repoPathKey('D:\\', 'win32')).toBe('d:\\');
    expect(repoPathKey('/', 'linux')).toBe('/');
  });
});
