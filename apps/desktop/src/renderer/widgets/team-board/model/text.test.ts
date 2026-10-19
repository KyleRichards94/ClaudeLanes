import { describe, expect, it } from 'vitest';
import { workItemText } from './text';

describe('workItemText', () => {
  it('reads Azure DevOps HTML as paragraphs and list items', () => {
    expect(workItemText('<div>The total rounds down.</div><ul><li>Totals match the grid.</li><li>Tax &amp; discount</li></ul>')).toBe(
      'The total rounds down.\n• Totals match the grid.\n• Tax & discount',
    );
  });
});
