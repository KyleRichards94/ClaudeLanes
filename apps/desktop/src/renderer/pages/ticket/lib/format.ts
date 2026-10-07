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
