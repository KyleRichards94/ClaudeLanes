import { describe, expect, it } from 'vitest';
import { PREFILL_LIMIT, htmlToText, workItemQuote } from './quote';

describe('work item quote (AL-162)', () => {
  it("quotes the work item's description and acceptance criteria as plain text", () => {
    expect(
      workItemQuote({
        description: '<div>Cut <b>frmJobControl</b> over to Blazor.</div><div>Keep the child modals &amp; invoker.</div>',
        acceptanceCriteria: '<ul><li>Grid filters work</li><li>bUnit tests pass</li></ul>',
      }),
    ).toBe('> Cut frmJobControl over to Blazor.\n> Keep the child modals & invoker.\n>\n> Acceptance criteria:\n> - Grid filters work\n> - bUnit tests pass\n\n');
  });

  it('is empty for a work item without either, and clips a long one', () => {
    expect(workItemQuote({ description: null, acceptanceCriteria: '  ' })).toBe('');
    expect(workItemQuote({ description: 'x'.repeat(PREFILL_LIMIT * 2) }).length).toBeLessThan(PREFILL_LIMIT + 10);
    expect(htmlToText('a&nbsp;&lt;b&gt;<br/>c')).toBe('a <b>\nc');
  });
});
