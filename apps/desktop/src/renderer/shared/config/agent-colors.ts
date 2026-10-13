/**
 * The agent colours both ticket layouts share (AL-278, handoff "Flight deck > Agent colours"). The lead
 * is always violet; sub-agents and second agents take the next colour in spawn order and the order
 * repeats after six. A file nobody recorded an edit for (you, or a merge) is neutral grey.
 */
export const LEAD_AGENT_COLOR = '#5B4BC4';
export const SUB_AGENT_COLORS = ['#0369A1', '#0D9488', '#7C3AED', '#B45309', '#DB2777', '#64748B'] as const;
export const UNKNOWN_AGENT_COLOR = '#94A3B8';
