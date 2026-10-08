import type { TicketRecord } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import {
  QA_FAILED_HEADING,
  QA_FAIL_ANSWER_HEADING,
  WORK_ITEM_COMMENT_DENIED,
  WORK_ITEM_COMMENT_RULE,
  workItemCommentBody,
  workItemCommentKind,
  workItemCommentVerdict,
  type CommentTicket,
} from './policy';

const ADO = { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 };

function ticket(stages: TicketRecord['stage'][], ado: CommentTicket['ado'] = ADO): CommentTicket {
  return { stage: stages.at(-1)!, stageHistory: stages.map((stage, at) => ({ stage, at })), ado };
}

const IN_QA = ticket(['queued', 'planning', 'implementing', 'code-review', 'qa']);
const BOUNCED = ticket(['queued', 'planning', 'implementing', 'code-review', 'qa', 'implementing']);
const FROM_FAILED = ticket(['queued', 'implementing'], { ...ADO, fromFailed: true });
const IMPLEMENTING = ticket(['queued', 'planning', 'implementing']);

const REPORT = `## ${QA_FAILED_HEADING}\n\n- AC 2 fails: the grid keeps the old filter. Evidence: screenshot of the job list after reload.`;
const ANSWER = `<p><b>${QA_FAIL_ANSWER_HEADING}</b></p><p>AC 2: the filter is now cleared on reload (JobGrid.razor).</p>`;

describe('workItemCommentBody', () => {
  it("reads the text of the Azure DevOps server's add-comment tool, whatever the server is called", () => {
    expect(workItemCommentBody('mcp__azure-devops__wit_add_work_item_comment', { project: 'p', workItemId: 1, comment: 'Hello' })).toBe('Hello');
    expect(workItemCommentBody('mcp__ado__add_work_item_comment', { id: 1, text: 'Hi' })).toBe('Hi');
    expect(workItemCommentBody('mcp__azure-devops__wit_add_work_item_comment', { workItemId: 1 })).toBe('');
  });

  it('counts a work item update that sets System.History as a comment', () => {
    expect(
      workItemCommentBody('mcp__azure-devops__wit_update_work_item', { id: 1, updates: [{ op: 'add', path: '/fields/System.History', value: 'Progress note' }] }),
    ).toBe('Progress note');
    expect(workItemCommentBody('mcp__ado__update_work_item', { id: 1, fields: { 'System.History': 'Note' } })).toBe('Note');
    expect(workItemCommentBody('mcp__azure-devops__wit_update_work_item', { id: 1, updates: [{ op: 'add', path: '/fields/System.State', value: 'Active' }] })).toBeNull();
  });

  it('leaves reads, pull request comments and tools outside MCP alone', () => {
    expect(workItemCommentBody('mcp__azure-devops__wit_list_work_item_comments', { workItemId: 1 })).toBeNull();
    expect(workItemCommentBody('mcp__azure-devops__wit_get_work_item', { id: 1 })).toBeNull();
    expect(workItemCommentBody('mcp__azure-devops__repo_create_pull_request_thread', { content: 'Nit' })).toBeNull();
    expect(workItemCommentBody('mcp__ado__add_pull_request_comment', { content: 'Nit' })).toBeNull();
    expect(workItemCommentBody('Bash', { command: 'echo comment' })).toBeNull();
  });
});

describe('workItemCommentKind', () => {
  it.each([
    [`${QA_FAILED_HEADING}: AC 2`, 'qa-failed'],
    ['## QA Failed', 'qa-failed'],
    ['**QA failure**\nAC 1', 'qa-failed'],
    ['<h2>QA failed</h2><ul><li>AC 1</li></ul>', 'qa-failed'],
    [`${QA_FAIL_ANSWER_HEADING}\nFixed AC 2`, 'qa-fail-answer'],
    ['### QA failed answer', 'qa-fail-answer'],
    ['<p><strong>QA fail answer</strong></p>', 'qa-fail-answer'],
  ] as const)('reads %j as %s', (body, kind) => {
    expect(workItemCommentKind(body)).toBe(kind);
  });

  it.each(['Agent Lanes · Planning', 'Started implementing', 'Plan: round each line', 'The QA failed earlier', ''])('has no QA heading in %j', (body) => {
    expect(workItemCommentKind(body)).toBeNull();
  });
});

describe('workItemCommentVerdict', () => {
  it('allows a "QA failed" report in the QA stage', () => {
    expect(workItemCommentVerdict(REPORT, IN_QA)).toEqual({ allowed: true, kind: 'qa-failed' });
  });

  it('allows a "QA fail answer" on a ticket QA sent back, or one launched from Failed', () => {
    expect(workItemCommentVerdict(ANSWER, BOUNCED)).toEqual({ allowed: true, kind: 'qa-fail-answer' });
    expect(workItemCommentVerdict(ANSWER, FROM_FAILED)).toEqual({ allowed: true, kind: 'qa-fail-answer' });
  });

  it('refuses anything without a QA heading, in any stage, with a message the agent can read', () => {
    for (const record of [IN_QA, BOUNCED, FROM_FAILED, IMPLEMENTING]) {
      const verdict = workItemCommentVerdict('Agent Lanes · Implementing — plan approved by Kyle', record);
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.message.startsWith(WORK_ITEM_COMMENT_DENIED)).toBe(true);
    }
  });

  it('refuses a report outside QA, and an answer on a ticket nobody sent back', () => {
    expect(workItemCommentVerdict(REPORT, IMPLEMENTING)).toMatchObject({ allowed: false });
    expect(workItemCommentVerdict(REPORT, BOUNCED)).toMatchObject({ allowed: false });
    expect(workItemCommentVerdict(ANSWER, IMPLEMENTING)).toMatchObject({ allowed: false });
    expect(workItemCommentVerdict(ANSWER, ticket(['queued', 'implementing'], null))).toMatchObject({ allowed: false });
  });

  it('refuses when the ticket cannot be read', () => {
    expect(workItemCommentVerdict(REPORT, undefined)).toMatchObject({ allowed: false });
  });

  it('states the rule the gate enforces', () => {
    expect(WORK_ITEM_COMMENT_RULE).toContain(`"${QA_FAILED_HEADING}"`);
    expect(WORK_ITEM_COMMENT_RULE).toContain(`"${QA_FAIL_ANSWER_HEADING}"`);
  });
});
