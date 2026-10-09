import type { SubagentNode } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { stageOf, subAgentRow, subAgentTree, tokensLabel } from './tree';

function fakeSubagent(fields: Partial<SubagentNode> & { id: string }): SubagentNode {
  return {
    taskId: null,
    parentId: null,
    name: fields.id,
    agentType: null,
    description: '',
    model: null,
    effort: null,
    status: 'running',
    activity: null,
    tokens: null,
    branch: null,
    readOnly: false,
    startedAt: 1,
    endedAt: null,
    ...fields,
  };
}

const lead = { stage: 'implementing', model: 'opus', effort: 'xhigh' } as const;

describe('subAgentTree (AL-177)', () => {
  it('nests sub-agents under the one that spawned them, oldest first', () => {
    const tree = subAgentTree([
      fakeSubagent({ id: 'b', startedAt: 2 }),
      fakeSubagent({ id: 'a', startedAt: 1 }),
      fakeSubagent({ id: 'a1', parentId: 'a', startedAt: 3 }),
    ]);
    expect(tree.map((item) => item.node.id)).toEqual(['a', 'b']);
    expect(tree[0]?.children.map((item) => item.node.id)).toEqual(['a1']);
  });

  it('puts a sub-agent whose parent was dropped at the top, and never loops', () => {
    const tree = subAgentTree([fakeSubagent({ id: 'orphan', parentId: 'gone' }), fakeSubagent({ id: 'self', parentId: 'self' })]);
    expect(tree.map((item) => item.node.id)).toEqual(['orphan', 'self']);
  });
});

describe('subAgentRow (AL-177)', () => {
  it('a reviewer queued before Code review says "Starts at the Code review stage"', () => {
    const reviewer = fakeSubagent({ id: 'r', name: 'reviewer', agentType: 'reviewer', status: 'queued', readOnly: true, description: 'Review the cutover' });
    expect(subAgentRow(reviewer, lead)).toEqual({
      name: 'reviewer',
      status: 'queued',
      statusLabel: 'Queued',
      line: 'Starts at the Code review stage',
      modelLine: 'Inherits Opus · XHigh',
      branchLine: '—',
    });
    expect(subAgentRow(reviewer, { ...lead, stage: 'planning' }).line).toBe('Starts at the Code review stage');
  });

  it('at Code review the reviewer shows what it was asked, and once running, its activity', () => {
    const reviewer = fakeSubagent({ id: 'r', agentType: 'code-reviewer', status: 'queued', description: 'Review the cutover' });
    expect(subAgentRow(reviewer, { ...lead, stage: 'code-review' }).line).toBe('Review the cutover');
    const running = { ...reviewer, status: 'running' as const, activity: 'Reading JobControl.razor', readOnly: true };
    expect(subAgentRow(running, { ...lead, stage: 'code-review' })).toMatchObject({ line: 'Reading JobControl.razor', branchLine: 'read-only' });
  });

  it('a writer shows its own model and effort and its sub-branch', () => {
    const writer = fakeSubagent({
      id: 'w',
      name: 'razor-writer',
      model: 'sonnet',
      effort: 'high',
      branch: 'sub/71273-grid',
      activity: 'Building JobGrid.razor column templates',
    });
    expect(subAgentRow(writer, lead)).toMatchObject({
      statusLabel: 'Running',
      line: 'Building JobGrid.razor column templates',
      modelLine: 'Sonnet · High',
      branchLine: 'sub/71273-grid',
    });
  });

  it('a finished read-only explorer says read-only', () => {
    const explore = fakeSubagent({ id: 'e', name: 'explore', model: 'haiku', effort: 'low', status: 'done', readOnly: true, activity: 'Mapped 4 child modals' });
    expect(subAgentRow(explore, lead)).toMatchObject({ statusLabel: 'Done', modelLine: 'Haiku · Low', branchLine: 'read-only' });
  });
});

describe('stageOf', () => {
  it('maps reviewers to Code review and testers to QA', () => {
    expect(stageOf({ agentType: 'reviewer', name: 'x' })).toBe('code-review');
    expect(stageOf({ agentType: null, name: 'security-reviewer' })).toBe('code-review');
    expect(stageOf({ agentType: 'qa-tester', name: 'x' })).toBe('qa');
    expect(stageOf({ agentType: 'razor-writer', name: 'x' })).toBeNull();
  });
});

describe('tokensLabel', () => {
  it('reads like the artboard', () => {
    expect(tokensLabel(212_400)).toBe('212k tokens');
    expect(tokensLabel(980)).toBe('980 tokens');
    expect(tokensLabel(1_240_000)).toBe('1.2M tokens');
  });
});
