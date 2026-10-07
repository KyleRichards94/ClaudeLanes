import type { ConnectionKind, ConnectionSummary } from '@agent-lanes/contracts';
import type { Tone } from '@agent-lanes/tokens';

/** A connection's state in words and a tone, for its row pill and its tab's dot (design §11: never colour alone). */
export interface ConnectionStatusView {
  label: string;
  tone: Tone;
}

/** The pill on a saved row (artboard 5: "Connected"). */
export function connectionStatusView(row: ConnectionSummary): ConnectionStatusView {
  if (row.needsReconnect) return { label: 'Reconnect needed', tone: 'danger' };
  if (row.status === 'error') return { label: 'Not connected', tone: 'danger' };
  if (row.status === 'untested') return { label: 'Not tested', tone: 'neutral' };
  if (row.kind === 'ado' && row.missingScopes.length > 0) return { label: 'Missing scopes', tone: 'attention' };
  return { label: 'Connected', tone: 'ok' };
}

/**
 * A tab's status dot (artboard 5): green when every row there is connected, amber when one needs
 * attention, red when one has failed, grey when nothing is saved.
 */
export function connectionTabStatus(rows: readonly ConnectionSummary[], kind: ConnectionKind): ConnectionStatusView {
  const mine = rows.filter((row) => row.kind === kind);
  if (mine.length === 0) return { label: 'Not connected', tone: 'neutral' };
  const views = mine.map(connectionStatusView);
  if (views.some((view) => view.tone === 'danger')) return { label: 'Needs attention', tone: 'danger' };
  if (views.some((view) => view.tone !== 'ok')) return { label: 'Needs attention', tone: 'attention' };
  return { label: 'Connected', tone: 'ok' };
}

/** Whether a row counts as connected for first run (AL-047): it passed its test and needs nothing. */
export function isConnected(row: ConnectionSummary): boolean {
  return row.status === 'ok' && !row.needsReconnect;
}
