import { describe, expect, it } from 'vitest';
import {
  BranchNamingError,
  MAX_BRANCH_NAME_LENGTH,
  findConflictingBranch,
  nameNoTicket,
  nameSubAgent,
  nameWorkItemTicket,
} from './branch-names';
import { checkBranchName } from './check-branch-name';
import { slugWords } from './slug';

const OCT_7 = new Date(2026, 9, 7, 9, 30);

/** Every generated name must be one git and Windows accept, plain ASCII, within the limit. */
function expectWellFormed(branch: string) {
  expect(checkBranchName(branch)).toEqual({ ok: true });
  const local = branch.startsWith('sub/') ? branch.slice('sub/'.length) : branch;
  expect(local).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
}

describe('nameWorkItemTicket', () => {
  it.each([
    // Artboard 2 and its work item list.
    [71273, 'Cutover frmJobControl to Blazor', '71273-cutover-frmjobcontrol-to'],
    [71330, 'Asset register paging slow above 5k rows', '71330-asset-register-paging-slow'],
    [71335, 'Client portal: show defect photos inline', '71335-client-portal-show-defect'],
    [71341, 'Roster view ignores public holidays', '71341-roster-view-ignores-public'],
  ])('follows the design: #%i "%s" → %s', (id, title, expected) => {
    expect(nameWorkItemTicket(id, title)).toEqual({ branch: expected, worktreeDirName: String(id) });
  });

  describe('unicode', () => {
    it.each([
      ['Café crème brûlée', '42-cafe-creme-brulee'],
      ['Straße größer machen', '42-strasse-grosser-machen'],
      ['Ærøskøbing færge', '42-aeroskobing-faerge'],
      ['Łódź Gdańsk', '42-lodz-gdansk'],
      ['İstanbul ıspanak', '42-istanbul-ispanak'],
      ['ＡＢＣ　ｆｉｘ', '42-abc-fix'],
      ['ﬁle ﬂow', '42-file-flow'],
      ['x² + y³', '42-x2-y3'],
      ['été decomposed', '42-ete-decomposed'],
      ['🚀 Launch the rocket 🚀', '42-launch-the-rocket'],
      ['Fix 日本 grid', '42-fix-grid'],
      ['日本語のタイトル', '42-untitled'],
      ['Исправить сетку', '42-untitled'],
    ])('%j → %s', (title, expected) => {
      const { branch } = nameWorkItemTicket(42, title);
      expect(branch).toBe(expected);
      expectWellFormed(branch);
    });
  });

  describe('punctuation', () => {
    it.each([
      ["Don't crash on O'Brien's jobs", '42-dont-crash-on-obriens-jobs'],
      ['Don’t stop', '42-dont-stop'],
      ['[Bug] Grid — paging/sorting (v2.5)!!!', '42-bug-grid-paging-sorting-v2-5'],
      ['frm_job_control.vb', '42-frm-job-control-vb'],
      ['--- leading and trailing ---', '42-leading-and-trailing'],
      ['C# / .NET 8 upgrade', '42-c-net-8-upgrade'],
      ['“Smart” quotes & ampersands', '42-smart-quotes-ampersands'],
      ['Line one\n\tline two', '42-line-one-line-two'],
      ['Refs: @{-1} ~ ^ : ? * [ \\ .. .lock', '42-refs-1-lock'],
      ['UPPER lower MiXeD', '42-upper-lower-mixed'],
      ['!!!', '42-untitled'],
      ['   ', '42-untitled'],
      ['', '42-untitled'],
    ])('%j → %s', (title, expected) => {
      const { branch } = nameWorkItemTicket(42, title);
      expect(branch).toBe(expected);
      expectWellFormed(branch);
    });
  });

  describe('long titles', () => {
    it.each([
      // Whole words only: the next word would pass 32 characters.
      [1, 'Make the board refresh every sixty seconds while open', '1-make-the-board-refresh-every'],
      // A first word longer than the room is cut, so the name keeps a slug.
      [71273, 'Supercalifragilisticexpialidocious fix', '71273-supercalifragilisticexpial'],
      // A later word that doesn't fit is dropped whole, not cut.
      [71273, 'Fix internationalisationframeworkconfiguration', '71273-fix'],
      [123456789, 'Grid', '123456789-grid'],
    ])('#%i %j → %s', (id, title, expected) => {
      const { branch } = nameWorkItemTicket(id, title);
      expect(branch).toBe(expected);
      expect(branch.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expectWellFormed(branch);
    });

    it('stays within 32 characters for any length of title', () => {
      const title = 'word '.repeat(500) + 'x'.repeat(500);
      const { branch } = nameWorkItemTicket(71273, title);
      expect(branch).toBe('71273-word-word-word-word-word');
      expectWellFormed(branch);
    });
  });

  describe('collisions', () => {
    it.each<[string, number, string, string[], string]>([
      ['exact match', 71273, 'Cutover frmJobControl to Blazor', ['71273-cutover-frmjobcontrol-to'], '71273-cutover-frmjobcontrol-to-2'],
      [
        'base and -2 taken',
        71273,
        'Cutover frmJobControl to Blazor',
        ['71273-cutover-frmjobcontrol-to', '71273-cutover-frmjobcontrol-to-2'],
        '71273-cutover-frmjobcontrol-to-3',
      ],
      ['different case', 71273, 'Cutover frmJobControl to Blazor', ['71273-Cutover-FrmJobControl-To'], '71273-cutover-frmjobcontrol-to-2'],
      [
        'a branch under the name',
        71273,
        'Cutover frmJobControl to Blazor',
        ['71273-cutover-frmjobcontrol-to/experiment'],
        '71273-cutover-frmjobcontrol-to-2',
      ],
      [
        '32-character name: the suffix replaces the last word',
        71330,
        'Asset register paging slow above 5k rows',
        ['71330-asset-register-paging-slow'],
        '71330-asset-register-paging-2',
      ],
      [
        'cut first word: cut shorter to fit the suffix',
        71273,
        'Supercalifragilisticexpialidocious',
        ['71273-supercalifragilisticexpial'],
        '71273-supercalifragilisticexpi-2',
      ],
      [
        'two-digit suffix',
        71273,
        'Cutover frmJobControl to Blazor',
        ['71273-cutover-frmjobcontrol-to', ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `71273-cutover-frmjobcontrol-to-${n}`)],
        '71273-cutover-frmjobcontrol-10',
      ],
      ['a gap is reused', 42, 'Grid', ['42-grid', '42-grid-3'], '42-grid-2'],
      ['unrelated branches', 42, 'Grid', ['main', 'develop', '42-grid-filters', '42', 'sub/42-grid'], '42-grid'],
    ])('%s', (_case, id, title, existing, expected) => {
      const { branch, worktreeDirName } = nameWorkItemTicket(id, title, existing);
      expect(branch).toBe(expected);
      expect(worktreeDirName).toBe(String(id));
      expect(branch.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(findConflictingBranch(branch, existing)).toBeUndefined();
      expectWellFormed(branch);
    });

    it('accepts any iterable of branch names', () => {
      const existing = new Set(['42-grid']);
      expect(nameWorkItemTicket(42, 'Grid', existing.values()).branch).toBe('42-grid-2');
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('refuses work item id %s', (id) => {
    expect(() => nameWorkItemTicket(id, 'Grid')).toThrow(RangeError);
  });
});

describe('nameNoTicket', () => {
  it.each<[string, Date, string, string[], string]>([
    ['description slug, local date', OCT_7, 'Fix the flaky login test on CI', [], 'nt-20261007-fix-the-flaky-login'],
    ['zero-padded month and day', new Date(2026, 0, 5, 23, 59), 'Spike', [], 'nt-20260105-spike'],
    ['empty description', OCT_7, '', [], 'nt-20261007-untitled'],
    ['unicode', OCT_7, 'Überprüfen größe', [], 'nt-20261007-uberprufen-grosse'],
    [
      'same day, same description',
      OCT_7,
      'Fix the flaky login test on CI',
      ['nt-20261007-fix-the-flaky-login'],
      'nt-20261007-fix-the-flaky-2',
    ],
  ])('%s', (_case, date, description, existing, expected) => {
    const named = nameNoTicket(date, description, existing);
    expect(named).toEqual({ branch: expected, worktreeDirName: expected });
    expect(named.branch.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    expectWellFormed(named.branch);
  });

  it('refuses an invalid date', () => {
    expect(() => nameNoTicket(new Date(Number.NaN), 'Spike')).toThrow(RangeError);
  });
});

describe('nameSubAgent', () => {
  it.each<[string, string | number, string, string[], string, string]>([
    ['design example', 71273, 'grid', [], 'sub/71273-grid', '71273--grid'],
    ['ticket id as a string', '71273', 'Tests', [], 'sub/71273-tests', '71273--tests'],
    ['SDK-style name', 71273, 'agent-a1b2c3d4', [], 'sub/71273-agent-a1b2c3d4', '71273--agent-a1b2c3d4'],
    ['empty name', 71273, '', [], 'sub/71273-agent', '71273--agent'],
    ['unicode and punctuation', 71273, 'Grid: Spalten-Größe', [], 'sub/71273-grid-spalten-grosse', '71273--grid-spalten-grosse'],
    [
      'long name, cut on a word boundary',
      71273,
      'refactor the job control grid filters and paging',
      [],
      'sub/71273-refactor-the-job-control',
      '71273--refactor-the-job-control',
    ],
    ['collision', 71273, 'grid', ['sub/71273-grid'], 'sub/71273-grid-2', '71273--grid-2'],
    ['collision, different case', 71273, 'grid', ['SUB/71273-Grid', 'sub/71273-grid-2'], 'sub/71273-grid-3', '71273--grid-3'],
    ['ticket branch is not a clash', 71273, 'grid', ['71273-grid'], 'sub/71273-grid', '71273--grid'],
    [
      'no-ticket id keeps room for the name',
      'nt-20261007-fix-the-flaky-login',
      'grid',
      [],
      'sub/nt-20261007-fix-the-flaky-login-grid',
      'nt-20261007-fix-the-flaky-login--grid',
    ],
    [
      'no-ticket id, long name is cut to the minimum',
      'nt-20261007-fix-the-flaky-login',
      'integration tests',
      [],
      'sub/nt-20261007-fix-the-flaky-login-integrat',
      'nt-20261007-fix-the-flaky-login--integrat',
    ],
  ])('%s', (_case, ticketId, agentName, existing, branch, worktreeDirName) => {
    expect(nameSubAgent(ticketId, agentName, existing)).toEqual({ branch, worktreeDirName });
    expect(findConflictingBranch(branch, existing)).toBeUndefined();
    expectWellFormed(branch);
  });

  it('throws when a branch named "sub" blocks every sub-branch', () => {
    const attempt = () => nameSubAgent(71273, 'grid', ['main', 'Sub']);
    expect(attempt).toThrow(BranchNamingError);
    expect(attempt).toThrow(/"Sub"/);
  });

  it.each(['', 'Foo', '71273 grid', '../71273', 'sub/71273', '71273-', '-71273'])('refuses ticket id %j', (id) => {
    expect(() => nameSubAgent(id, 'grid')).toThrow(RangeError);
  });
});

describe('findConflictingBranch', () => {
  it.each<[string, string[], string | undefined]>([
    ['a', ['a'], 'a'],
    ['A', ['a'], 'a'],
    ['a', ['a/b'], 'a/b'],
    ['a/b', ['a'], 'a'],
    ['a/b/c', ['a/b'], 'a/b'],
    ['a/b', ['a/b/c/d'], 'a/b/c/d'],
    ['ab', ['a', 'a/b', 'abc', 'b'], undefined],
    ['a-b', ['a'], undefined],
    ['a', [], undefined],
  ])('%j against %j → %j', (name, existing, expected) => {
    expect(findConflictingBranch(name, existing)).toBe(expected);
  });
});

describe('slugWords', () => {
  it('splits camelCase as one word, like the design', () => {
    expect(slugWords('frmJobControl')).toEqual(['frmjobcontrol']);
  });
});
