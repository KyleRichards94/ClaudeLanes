import { describe, expect, it } from 'vitest';
import { isInsidePath, normalizePath, recordFilePath, repoKey, ticketsRootDir } from './paths';

describe('repoKey', () => {
  it('is the folder name made file-safe plus a hash of the path', () => {
    expect(repoKey('C:\\src\\OnSite Companion', 'win32')).toMatch(/^onsite-companion-[0-9a-f]{12}$/);
    expect(repoKey('/home/kyle/src/agent.lanes', 'linux')).toMatch(/^agent-lanes-[0-9a-f]{12}$/);
  });

  it('is the same however Windows spells the path', () => {
    const key = repoKey('C:\\src\\onsite-companion', 'win32');
    expect(repoKey('c:\\SRC\\OnSite-Companion\\', 'win32')).toBe(key);
    expect(repoKey('C:/src/onsite-companion', 'win32')).toBe(key);
    expect(repoKey('C:\\src\\other\\..\\onsite-companion', 'win32')).toBe(key);
  });

  it('keeps case on Linux, where it names another folder', () => {
    expect(repoKey('/src/App', 'linux')).not.toBe(repoKey('/src/app', 'linux'));
  });

  it('separates two repos with the same folder name', () => {
    expect(repoKey('C:\\work\\app', 'win32')).not.toBe(repoKey('D:\\home\\app', 'win32'));
  });

  it('falls back to "repo" for a name with no usable characters and caps long names', () => {
    expect(repoKey('C:\\src\\Übersicht', 'win32')).toMatch(/^bersicht-/);
    expect(repoKey('C:\\src\\ü', 'win32')).toMatch(/^repo-[0-9a-f]{12}$/);
    expect(repoKey('C:\\', 'win32')).toMatch(/^repo-[0-9a-f]{12}$/);
    const long = repoKey(`C:\\src\\${'a-'.repeat(40)}`, 'win32');
    expect(long.length).toBeLessThanOrEqual(40 + 1 + 12);
    expect(long).not.toMatch(/--/);
  });
});

describe('recordFilePath', () => {
  it('puts the record in the repo folder under the tickets root', () => {
    const root = ticketsRootDir('C:\\Users\\kyle\\AppData\\Roaming\\Agent Lanes', 'win32');
    expect(root).toBe('C:\\Users\\kyle\\AppData\\Roaming\\Agent Lanes\\tickets');
    expect(recordFilePath(root, 'C:\\src\\onsite-companion', '71273', 'win32')).toBe(
      `${root}\\${repoKey('C:\\src\\onsite-companion', 'win32')}\\71273.json`,
    );
  });
});

describe('isInsidePath', () => {
  it.each([
    ['C:\\wt\\71273\\file.json', 'C:\\wt\\71273', true],
    ['C:\\wt\\71273', 'C:\\wt\\71273', true],
    ['c:\\WT\\71273\\x', 'C:\\wt\\71273\\', true],
    ['C:\\wt\\71273-2\\x', 'C:\\wt\\71273', false],
    ['C:\\wt', 'C:\\wt\\71273', false],
    ['D:\\wt\\71273\\x', 'C:\\wt\\71273', false],
    ['C:\\wt\\..foo\\x', 'C:\\wt', true],
    ['C:\\wt\\71273\\..\\other', 'C:\\wt\\71273', false],
  ])('win32: %s inside %s → %s', (child, parent, expected) => {
    expect(isInsidePath(child, parent, 'win32')).toBe(expected);
  });

  it.each([
    ['/wt/71273/file.json', '/wt/71273', true],
    ['/WT/71273/file.json', '/wt/71273', false],
    ['/wt/71273-2', '/wt/71273', false],
    ['/', '/wt', false],
  ])('posix: %s inside %s → %s', (child, parent, expected) => {
    expect(isInsidePath(child, parent, 'linux')).toBe(expected);
  });
});

describe('normalizePath', () => {
  it('lowercases on Windows only', () => {
    expect(normalizePath('C:\\Src\\App\\', 'win32')).toBe('c:\\src\\app');
    expect(normalizePath('/Src/App/', 'linux')).toBe('/Src/App');
  });
});
