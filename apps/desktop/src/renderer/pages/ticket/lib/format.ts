import { formatCostUsd, formatTokenCount, type AgentUsage } from '@agent-lanes/contracts';

/** "45s" → "<1m", "12m", "1h 12m", "2d 3h". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Local wall-clock time, "14:02". */
export function formatClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The last folder of a path, either slash: `C:\src\onsite-companion` → `onsite-companion`. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** "OnSite Companion\Sprint 42" → "Sprint 42". */
export function sprintName(iterationPath: string): string {
  return iterationPath.split('\\').filter(Boolean).at(-1) ?? iterationPath;
}

/** A session id as the pill shows it (AL-252): a UUID's first group ("9ad804aa"); shorter ids whole. */
export function shortSessionId(id: string): string {
  const match = /^([0-9a-f]{8})-[0-9a-f]{4}-/i.exec(id);
  return match ? match[1]! : id;
}

/** "Session cc-71273 · 1h 12m · 412k tokens" (artboard 3); the tokens part appears once the session used any (AL-113). */
export function sessionPillLabel(id: string, startedAt: number | null, now: number, usage?: Pick<AgentUsage, 'totalTokens'>): string {
  const parts = [`Session ${shortSessionId(id)}`];
  if (startedAt !== null) parts.push(formatDuration(now - startedAt));
  if (usage && usage.totalTokens > 0) parts.push(formatTokenCount(usage.totalTokens));
  return parts.join(' · ');
}

/**
 * The session pill's tooltip (AL-113: cost is shown in a tooltip only): "Cost about $1.24 · Context
 * 25% of 200k · 3 turns", with the full session id first when the pill shortens it (AL-252). Null
 * when there is nothing to say yet.
 */
export function sessionUsageDetails(usage: AgentUsage, sessionId?: string): string | null {
  const idLine = sessionId && shortSessionId(sessionId) !== sessionId ? [`Session ${sessionId}`] : [];
  if (usage.turns === 0 && usage.context === null) return idLine[0] ?? null;
  const parts = [...idLine, `Cost about ${formatCostUsd(usage.costUsd)}`];
  // A window of 0 is an unmeasured one, not "0% of 0" (AL-254).
  if (usage.context && usage.context.maxTokens > 0) parts.push(`Context ${Math.round(usage.context.percentage)}% of ${formatTokenCount(usage.context.maxTokens).replace(/ tokens$/, '')}`);
  parts.push(`${usage.turns} turn${usage.turns === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
