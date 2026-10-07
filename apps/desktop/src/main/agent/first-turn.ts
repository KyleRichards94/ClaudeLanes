/**
 * The first user turn of a new ticket session (AL-100): what the agent is asked to do, the work item
 * it works on, the skills the user picked, and how it reports its stages (AL-103).
 */

/** The work item as the launch knows it (AL-161); its description may be ADO's HTML. */
export interface SessionWorkItem {
  id: number;
  title: string;
  /** "User Story", "Bug", … */
  type?: string | null;
  /** "Active", "New", … */
  state?: string | null;
  description?: string | null;
}

export interface FirstTurnInput {
  ticketId: string;
  title: string;
  /** "What should the agent do?" (artboard 2). */
  jobDescription: string;
  workItem?: SessionWorkItem | null;
  /** Skill names without the slash, e.g. `code-review`. */
  skills: readonly string[];
  /** Extra sections, e.g. the stage protocol (AL-103). */
  appendix?: readonly string[];
}

/** Longest work item description passed on; the agent can read the rest through the ADO MCP server (AL-108). */
export const WORK_ITEM_DESCRIPTION_LIMIT = 4_000;

/** ADO descriptions are HTML: keep the text, one paragraph per block. */
export function plainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildFirstTurn(input: FirstTurnInput): string {
  const sections: string[] = [];
  const item = input.workItem;
  if (item) {
    const kind = [item.type, item.state].filter(Boolean).join(' · ');
    sections.push(`You are working on Azure DevOps work item #${item.id}: ${item.title}${kind ? ` (${kind})` : ''}.`);
    const description = item.description ? plainText(item.description) : '';
    if (description) {
      const clipped = description.length > WORK_ITEM_DESCRIPTION_LIMIT ? `${description.slice(0, WORK_ITEM_DESCRIPTION_LIMIT)}…` : description;
      sections.push(`Work item description:\n${clipped}`);
    }
  } else {
    sections.push(`You are working on the Agent Lanes ticket ${input.ticketId}: ${input.title}. It has no Azure DevOps work item.`);
  }
  sections.push(`What to do:\n${input.jobDescription.trim()}`);
  if (input.skills.length > 0) {
    sections.push(`Use these skills where they fit: ${input.skills.map((skill) => `/${skill}`).join(', ')}.`);
  }
  sections.push(...(input.appendix ?? []));
  return sections.join('\n\n');
}
