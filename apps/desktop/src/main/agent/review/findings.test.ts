import { ReviewFindingSchema } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { eventLog } from '../testing/output-events';
import { REVIEW_FINDINGS_INSTRUCTION, findingsOf, parseReviewBlocks, replayReview, reviewStatusOf, type ReviewSource } from './findings';

const LEAD = '71273';
const REVIEWER = '71273-reviewer-eyes';

function block(file: string, status: string, findings: unknown[] = []): string {
  return `Reviewed ${file}.\n\n\`\`\`json\n${JSON.stringify({ file, status, findings })}\n\`\`\`\n`;
}

const source = (agentId: string, log: ReturnType<typeof eventLog>, reviewing = true): ReviewSource => ({ agentId, events: log.events, reviewing });

describe('review block parser (AL-277)', () => {
  it('parses a fenced json block', () => {
    const text = block('src/Grid.razor', 'changesRequested', [{ line: 12, severity: 'warn', text: 'Missing null check.' }]);
    expect(parseReviewBlocks(text)).toEqual([{ file: 'src/Grid.razor', status: 'changesRequested', findings: [{ line: 12, severity: 'warn', text: 'Missing null check.' }] }]);
  });

  it('parses several blocks in one text, in order, and a bare fence', () => {
    const text = `${block('a.cs', 'passed')}\nThen the next.\n\`\`\`\n${JSON.stringify({ file: 'b.cs', status: 'passed', findings: [] })}\n\`\`\``;
    expect(parseReviewBlocks(text).map((parsed) => [parsed.file, parsed.status])).toEqual([
      ['a.cs', 'passed'],
      ['b.cs', 'passed'],
    ]);
  });

  it('ignores a malformed block and keeps the good ones', () => {
    const text = [
      '```json\n{"file": "a.cs", "status": "passed", "findings": [\n```',
      '```json\n{"file": "b.cs"}\n```',
      '```json\n{"file": "c.cs", "status": "great"}\n```',
      '```ts\nconst x = {"file": "d.cs", "status": "passed"};\n```',
      block('e.cs', 'passed'),
    ].join('\n');
    expect(parseReviewBlocks(text).map((parsed) => parsed.file)).toEqual(['e.cs']);
    expect(parseReviewBlocks('no blocks here')).toEqual([]);
    expect(parseReviewBlocks('```json\nnot json "file" "status"\n```')).toEqual([]);
  });

  it('is tolerant about status spelling, severity words, missing lines and bad findings', () => {
    const [parsed] = parseReviewBlocks(
      block('a.cs', 'changes_requested', [{ line: 3, severity: 'warning', text: ' Rename it. ' }, { severity: 'nope', text: 'No line.' }, { line: -2, text: 'Negative line.' }, { line: 4 }, 'junk', null]),
    );
    expect(parsed).toEqual({
      file: 'a.cs',
      status: 'changesRequested',
      findings: [
        { line: 3, severity: 'warn', text: 'Rename it.' },
        { line: null, severity: 'info', text: 'No line.' },
        { line: null, severity: 'info', text: 'Negative line.' },
      ],
    });
  });

  it('the instruction names the exact shape', () => {
    expect(REVIEW_FINDINGS_INSTRUCTION).toContain('"file"');
    expect(REVIEW_FINDINGS_INSTRUCTION).toContain('"passed" | "changesRequested"');
    expect(REVIEW_FINDINGS_INSTRUCTION).toContain('"info" | "warn" | "error"');
    // Its own example is not mistaken for a review.
    expect(parseReviewBlocks(REVIEW_FINDINGS_INSTRUCTION)).toEqual([]);
  });
});

describe('review replay (AL-277)', () => {
  it('makes findings with stable ids from the reviewer and from the lead, whose ids are the agent that wrote the text', () => {
    const reviewer = eventLog(REVIEWER);
    reviewer.text(block('src/Grid.razor', 'changesRequested', [{ line: 12, severity: 'error', text: 'Crashes on an empty grid.' }, { severity: 'info', text: 'Nice split.' }]));
    const lead = eventLog(LEAD);
    lead.text(block('src/Other.cs', 'passed'), 'toolu_sub');
    const replay = replayReview([source(LEAD, lead), source(REVIEWER, reviewer)]);

    const findings = findingsOf(replay);
    expect(findings.map((finding) => finding.id)).toEqual([`${REVIEWER}:src/Grid.razor:12:0`, `${REVIEWER}:src/Grid.razor:0:1`]);
    expect(findings[0]).toEqual({ id: `${REVIEWER}:src/Grid.razor:12:0`, filePath: 'src/Grid.razor', line: 12, severity: 'error', text: 'Crashes on an empty grid.', agentId: REVIEWER });
    for (const finding of findings) expect(ReviewFindingSchema.safeParse(finding).success).toBe(true);
    expect(reviewStatusOf(replay, 'src/Other.cs')).toBe('passed');
    // Replaying again gives the same ids.
    expect(findingsOf(replayReview([source(LEAD, lead), source(REVIEWER, reviewer)]))).toEqual(findings);
  });

  it('a later block for the same file replaces the earlier one', () => {
    const reviewer = eventLog(REVIEWER);
    reviewer.text(block('src/Grid.razor', 'changesRequested', [{ line: 1, severity: 'warn', text: 'Old note.' }]));
    reviewer.text(block('src/Grid.razor', 'passed', []));
    reviewer.text(block('src/Other.cs', 'changesRequested', [{ line: 2, severity: 'warn', text: 'Other note.' }]));
    const replay = replayReview([source(REVIEWER, reviewer)]);
    expect(reviewStatusOf(replay, 'src/Grid.razor')).toBe('passed');
    expect(findingsOf(replay).map((finding) => finding.text)).toEqual(['Other note.']);
  });

  it('ignores streamed deltas, the user messages and blocks outside the worktree', () => {
    const reviewer = eventLog(REVIEWER);
    reviewer.events.push({ ticketId: REVIEWER, at: 9, seq: 99, item: { kind: 'text-delta', streamId: 's', text: block('a.cs', 'passed'), parentToolUseId: null } });
    reviewer.events.push({ ticketId: REVIEWER, at: 10, seq: 100, item: { kind: 'user', messageId: null, text: block('b.cs', 'passed'), priority: null, source: 'composer', parentToolUseId: null } });
    reviewer.text(block('../outside.cs', 'passed'));
    expect(replayReview([source(REVIEWER, reviewer)]).files.size).toBe(0);
  });

  it('turns an absolute path inside the worktree into a relative one', () => {
    const reviewer = eventLog(REVIEWER);
    reviewer.text(block('C:\\src\\wt\\src\\Grid.razor', 'passed'));
    const replay = replayReview([{ agentId: REVIEWER, events: reviewer.events, cwd: 'C:\\src\\wt', reviewing: true }]);
    expect(reviewStatusOf(replay, 'src/Grid.razor')).toBe('passed');
  });
});

describe('review status (AL-277)', () => {
  it('is notReviewed with no block and no reads', () => {
    const reviewer = eventLog(REVIEWER);
    expect(reviewStatusOf(replayReview([source(REVIEWER, reviewer)]), 'src/Grid.razor')).toBe('notReviewed');
  });

  it('is inReview while the reviewer reads the file and it has no block yet', () => {
    const reviewer = eventLog(REVIEWER);
    reviewer.read('r1', 'src/Grid.razor');
    reviewer.read('r2', 'src/Other.cs');
    const replay = replayReview([source(REVIEWER, reviewer)]);
    // Its latest call is the read of Other.cs.
    expect(reviewStatusOf(replay, 'src/Other.cs')).toBe('inReview');
    expect(reviewStatusOf(replay, 'src/Grid.razor')).toBe('notReviewed');

    reviewer.bash('b1', 'dotnet test');
    expect(reviewStatusOf(replayReview([source(REVIEWER, reviewer)]), 'src/Other.cs')).toBe('notReviewed');
  });

  it('a block settles the file, and the end of the turn ends the reading', () => {
    const reviewer = eventLog(REVIEWER);
    reviewer.read('r1', 'src/Grid.razor');
    reviewer.text(block('src/Grid.razor', 'passed'));
    expect(reviewStatusOf(replayReview([source(REVIEWER, reviewer)]), 'src/Grid.razor')).toBe('passed');

    const ended = eventLog(REVIEWER);
    ended.read('r1', 'src/Grid.razor');
    expect(reviewStatusOf(replayReview([source(REVIEWER, ended)]), 'src/Grid.razor')).toBe('inReview');
    ended.turnEnded();
    expect(reviewStatusOf(replayReview([source(REVIEWER, ended)]), 'src/Grid.razor')).toBe('notReviewed');
  });

  it('only agents that review show a file in review: the lead outside Code review does not', () => {
    const lead = eventLog(LEAD);
    lead.read('r1', 'src/Grid.razor');
    expect(reviewStatusOf(replayReview([source(LEAD, lead, false)]), 'src/Grid.razor')).toBe('notReviewed');
    expect(reviewStatusOf(replayReview([source(LEAD, lead, true)]), 'src/Grid.razor')).toBe('inReview');
  });

  it("a sub-agent's read counts as its own: the lead's next call does not end it", () => {
    const lead = eventLog(LEAD);
    lead.read('r1', 'src/Grid.razor', 'toolu_sub');
    lead.bash('b1', 'git status');
    expect(reviewStatusOf(replayReview([source(LEAD, lead, true)]), 'src/Grid.razor')).toBe('inReview');
  });

  it('matches paths by case', () => {
    const reviewer = eventLog(REVIEWER);
    reviewer.text(block('src/grid.razor', 'changesRequested'));
    expect(reviewStatusOf(replayReview([source(REVIEWER, reviewer)]), 'src/Grid.razor')).toBe('changesRequested');
  });
});
