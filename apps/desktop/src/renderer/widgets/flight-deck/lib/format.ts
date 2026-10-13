import { MIN_TEXT_CONTRAST, color, contrastRatio } from '@agent-lanes/tokens';

/** A stage's length: "<1m", "12m", "1h 12m", "2d 3h". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** A turn's length to the second: "48s", "4m 12s", "1h 05m" (the turn rows' "Turn 3 · 4m 12s · $0.42"). */
export function formatTurnDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** "$2.06"; a cost under a cent reads "<$0.01" and none at all "$0.00". */
export function formatCost(usd: number): string {
  return usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

/** "1 turn", "7 turns". */
export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "212k", "1.4M", "850": a token count as a bar's label. */
export function compactTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 999_500) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** The last segment of a path, either slash: "src/Pages/FailedSyncFiles.razor" → "FailedSyncFiles.razor". */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** The first letter of a name, upper case, for an agent's tile. */
export function initialOf(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

/** White, or the ink when white would read under 4.5:1 on `background`: text on an agent's colour. */
export function readableOn(background: string): string {
  return contrastRatio('#FFFFFF', background) >= MIN_TEXT_CONTRAST ? '#FFFFFF' : color.ink;
}
