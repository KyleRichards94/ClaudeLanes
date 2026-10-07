import { describe, expect, it } from 'vitest';
import {
  AGENT_LANES_COMMENT_PREFIX,
  WORK_ITEM_COMMENT_MAX_LENGTH,
  WorkItemCommentSchema,
  WorkItemCommentTextSchema,
  WorkItemStateChangeSchema,
  WorkItemStateNameSchema,
  WorkItemStateWriteBackSchema,
  isAgentLanesComment,
  withAgentLanesPrefix,
} from './ado.write-back';

describe('Agent Lanes comment prefix', () => {
  it('is "Agent Lanes · "', () => {
    expect(AGENT_LANES_COMMENT_PREFIX).toBe('Agent Lanes · ');
  });

  it.each([
    ['plain text', 'Agent Lanes · Implementing — plan approved by Kyle'],
    ['the prefix alone', 'Agent Lanes ·'],
    ['HTML ADO wrapped in a div', '<div>Agent Lanes · Planning</div>'],
    ['nested tags and leading space', ' <div><p>  Agent Lanes · QA</p></div>'],
    ['the dot as &middot;', '<div>Agent Lanes &middot; Code review</div>'],
    ['the dot as &#183;', 'Agent Lanes &#183; Code review'],
    ['the dot as &#xB7;', 'Agent Lanes &#xB7; Code review'],
    ['a non-breaking space', 'Agent Lanes\u00a0· Create PR'],
    ['&nbsp; before the dot', 'Agent Lanes&nbsp;· Create PR'],
  ])('recognises %s', (_case, text) => {
    expect(isAgentLanesComment(text)).toBe(true);
  });

  it.each([
    ['a person’s comment', '<div>Can we keep the old grid?</div>'],
    ['the name later in the text', 'Thanks, Agent Lanes · nice work'],
    ['a different dot', 'Agent Lanes - Planning'],
    ['different case', 'agent lanes · Planning'],
    ['an empty comment', ''],
    ['an unterminated tag', '<div'],
  ])('does not claim %s', (_case, text) => {
    expect(isAgentLanesComment(text)).toBe(false);
  });

  it('stays quick on a long run of markup', () => {
    const started = Date.now();
    expect(isAgentLanesComment('<'.repeat(200_000))).toBe(false);
    // Only the start of a comment is searched: a prefix behind 250 000 characters of tags is not one.
    expect(isAgentLanesComment(`${'<div>'.repeat(50_000)}Agent Lanes · late`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('adds the prefix once', () => {
    expect(withAgentLanesPrefix('Planning')).toBe('Agent Lanes · Planning');
    expect(withAgentLanesPrefix('Agent Lanes · Planning')).toBe('Agent Lanes · Planning');
    // Plain text is not markup: a tag in front means the prefix is still missing.
    expect(withAgentLanesPrefix('<b>Agent Lanes · Planning')).toBe('Agent Lanes · <b>Agent Lanes · Planning');
  });
});

describe('write-back schemas', () => {
  it('limits comment text to 1–10 000 characters after trimming', () => {
    expect(WORK_ITEM_COMMENT_MAX_LENGTH).toBe(10_000);
    expect(WorkItemCommentTextSchema.parse('  Planning \n')).toBe('Planning');
    expect(WorkItemCommentTextSchema.safeParse('   ').success).toBe(false);
    expect(WorkItemCommentTextSchema.safeParse('x'.repeat(10_001)).success).toBe(false);
  });

  it('takes a state name without control characters, trimmed', () => {
    expect(WorkItemStateNameSchema.parse(' Resolved ')).toBe('Resolved');
    expect(WorkItemStateNameSchema.parse('Ready for QA')).toBe('Ready for QA');
    expect(WorkItemStateNameSchema.safeParse('Done\n').success).toBe(true); // trimmed first
    expect(WorkItemStateNameSchema.safeParse('Do\tne').success).toBe(false);
    expect(WorkItemStateNameSchema.safeParse('').success).toBe(false);
  });

  it('describes a comment as the ADO tab will read it', () => {
    const comment = {
      id: 3,
      workItemId: 71273,
      text: 'Agent Lanes · Planning',
      format: 'html',
      author: 'Kyle Richards',
      createdAt: '2026-10-07T03:04:05.123Z',
      updatedAt: null,
      fromAgentLanes: true,
    };
    expect(WorkItemCommentSchema.parse(comment)).toEqual(comment);
    expect(WorkItemCommentSchema.safeParse({ ...comment, workItemId: 0 }).success).toBe(false);
    expect(WorkItemCommentSchema.safeParse({ ...comment, format: 'rtf' }).success).toBe(false);
  });

  it('a state change is changed or unchanged; a write-back may also be disabled', () => {
    const changed = { outcome: 'changed', workItemId: 71273, state: 'Active', previousState: 'New', rev: 5 };
    const unchanged = { outcome: 'unchanged', workItemId: 71273, state: 'Active', rev: 5 };
    const disabled = { outcome: 'disabled', workItemId: 71273 };

    expect(WorkItemStateChangeSchema.safeParse(changed).success).toBe(true);
    expect(WorkItemStateChangeSchema.safeParse(unchanged).success).toBe(true);
    expect(WorkItemStateChangeSchema.safeParse(disabled).success).toBe(false);
    for (const value of [changed, unchanged, disabled]) expect(WorkItemStateWriteBackSchema.safeParse(value).success).toBe(true);
    expect(WorkItemStateWriteBackSchema.safeParse({ ...changed, previousState: undefined }).success).toBe(false);
  });
});
