/**
 * The job description a picked work item prefills (AL-162, artboard 2 "What should the agent do?"):
 * its description and acceptance criteria from Azure DevOps, as plain text in a quoted block the user
 * can edit or add to.
 */

/** Longest prefilled text; the agent reads the full work item through the ADO MCP server (AL-108). */
export const PREFILL_LIMIT = 4_000;

/** ADO's HTML as plain text, one paragraph or list item per line. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `> ` before every line (a bare `>` on blank lines), as in a Markdown quote. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
}

/**
 * "> Description…\n>\n> Acceptance criteria:\n> - …", followed by a blank line for the user's own
 * instructions; empty when the work item has neither.
 */
export function workItemQuote(item: { description?: string | null; acceptanceCriteria?: string | null }): string {
  const parts: string[] = [];
  const description = item.description ? htmlToText(item.description) : '';
  const criteria = item.acceptanceCriteria ? htmlToText(item.acceptanceCriteria) : '';
  if (description) parts.push(description);
  if (criteria) parts.push(`Acceptance criteria:\n${criteria}`);
  if (parts.length === 0) return '';
  let text = parts.join('\n\n');
  if (text.length > PREFILL_LIMIT) text = `${text.slice(0, PREFILL_LIMIT - 1)}…`;
  return `${quote(text)}\n\n`;
}
