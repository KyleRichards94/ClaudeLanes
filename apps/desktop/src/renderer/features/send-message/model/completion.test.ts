import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMITS } from '@agent-lanes/contracts';
import { attachmentKind, attachmentRefusal, formatBytes, type PendingAttachment } from './attachments';
import { applyCompletion, completionQuery, filterCommands, filterFiles, isSendKey, type CommandItem } from './completion';
import { getComposerHistory, pushHistory, recall, resetComposerHistory } from './history';

const commands: CommandItem[] = [
  { name: 'code-review', description: 'Review the branch', argumentHint: '', source: 'skill' },
  { name: 'commit', description: 'Commit the work', argumentHint: '<message>', source: 'command' },
  { name: 'compact', description: 'Fold the context', argumentHint: '', source: 'command' },
  { name: 'code-review', description: 'duplicate from the session', argumentHint: '', source: 'command' },
];

describe('composer completions (AL-259)', () => {
  it('finds a /command at the start and an @file after a space', () => {
    expect(completionQuery('/co', 3)).toEqual({ kind: 'command', word: 'co', start: 0, end: 3 });
    expect(completionQuery('/', 1)).toEqual({ kind: 'command', word: '', start: 0, end: 1 });
    expect(completionQuery('fix /co', 7)).toBeNull();
    expect(completionQuery('look at @Job', 12)).toEqual({ kind: 'file', word: 'Job', start: 8, end: 12 });
    expect(completionQuery('@src', 4)).toEqual({ kind: 'file', word: 'src', start: 0, end: 4 });
    expect(completionQuery('mail@example', 12)).toBeNull();
    // Only while the caret is at the word's end.
    expect(completionQuery('/co more', 3)).toEqual({ kind: 'command', word: 'co', start: 0, end: 3 });
    expect(completionQuery('plain words', 5)).toBeNull();
  });

  it('filters commands by name first, without duplicates, and files by every word', () => {
    expect(filterCommands(commands, '').map((item) => item.name)).toEqual(['code-review', 'commit', 'compact']);
    expect(filterCommands(commands, 'com').map((item) => item.name)).toEqual(['commit', 'compact']);
    expect(filterCommands(commands, 'fold').map((item) => item.name)).toEqual(['compact']);
    expect(filterFiles(['src/Jobs/JobGrid.razor', 'src/Jobs/JobFilter.cs', 'README.md'], 'job grid')).toEqual(['src/Jobs/JobGrid.razor']);
    expect(filterFiles(['b.cs', 'a/long/path.cs', 'a.cs'], '')).toEqual(['a.cs', 'b.cs', 'a/long/path.cs']);
  });

  it('replaces the trigger and word with the pick and a space', () => {
    expect(applyCompletion('/co', { kind: 'command', word: 'co', start: 0, end: 3 }, 'code-review')).toEqual({ text: '/code-review ', caret: 13 });
    expect(applyCompletion('look at @Job now', { kind: 'file', word: 'Job', start: 8, end: 12 }, 'src/JobGrid.razor')).toEqual({ text: 'look at @src/JobGrid.razor  now', caret: 27 });
  });

  it('sends on Enter alone', () => {
    expect(isSendKey({ key: 'Enter' })).toBe(true);
    expect(isSendKey({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isSendKey({ key: 'Enter', isComposing: true })).toBe(false);
    expect(isSendKey({ key: 'a' })).toBe(false);
  });
});

describe('composer history (AL-259)', () => {
  it('recalls earlier messages newest first, without repeats, up to the limit', () => {
    resetComposerHistory();
    pushHistory('71273', 'first');
    pushHistory('71273', 'second');
    pushHistory('71273', 'first');
    pushHistory('71273', '   ');
    expect(getComposerHistory('71273')).toEqual(['second', 'first']);
    expect(getComposerHistory('other')).toEqual([]);
    const list = ['second', 'first'];
    expect(recall(list, null, 'up')).toBe(1);
    expect(recall(list, 1, 'up')).toBe(0);
    expect(recall(list, 0, 'up')).toBe(0);
    expect(recall(list, 0, 'down')).toBe(1);
    expect(recall(list, 1, 'down')).toBeNull();
    expect(recall([], null, 'up')).toBeNull();
  });
});

describe('attachments (AL-259)', () => {
  const pending = (bytes: number): PendingAttachment => ({ kind: 'image', name: 'a.png', mediaType: 'image/png', data: '', bytes });

  it('knows which files it can send and refuses the rest with a reason', () => {
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('application/pdf')).toBe('document');
    expect(attachmentKind('text/plain')).toBe('text');
    expect(attachmentKind('application/json')).toBe('text');
    expect(attachmentKind('application/zip')).toBeNull();
    expect(attachmentRefusal([], { name: 'x.zip', bytes: 10, mediaType: 'application/zip' })).toMatch(/only images/);
    expect(attachmentRefusal([], { name: 'big.png', bytes: ATTACHMENT_LIMITS.bytesEach + 1, mediaType: 'image/png' })).toMatch(/limit is 4.0 MB per file/);
    expect(attachmentRefusal(Array.from({ length: ATTACHMENT_LIMITS.count }, () => pending(10)), { name: 'x.png', bytes: 10, mediaType: 'image/png' })).toMatch(/At most 5 files/);
    expect(attachmentRefusal([pending(ATTACHMENT_LIMITS.bytesTotal - 10)], { name: 'x.png', bytes: 20, mediaType: 'image/png' })).toMatch(/Together/);
    expect(attachmentRefusal([], { name: 'ok.png', bytes: 1024, mediaType: 'image/png' })).toBeNull();
    expect(formatBytes(1_300_000)).toBe('1.2 MB');
  });
});
