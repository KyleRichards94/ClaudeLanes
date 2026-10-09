import { useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { emptyAgentUsage, type AgentSessionState, type AgentSessionStatus, type AgentUsage, type WorkItem } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, GlassPanel, Icon, Pill, Text, type PillTone } from '@agent-lanes/ui';
import { routes, useNavigation } from '@/shared/routing';
import { folderName, sessionPillLabel, sessionUsageDetails, sprintName } from '../lib/format';

export interface TicketHeaderBandProps {
  ticketId: string;
  /** The ticket's title (the id when empty); without it the band has no title row (the missing-ticket page). */
  title?: string;
  /** The repo's main checkout; its folder name starts the breadcrumb. Undefined while unknown. */
  repo?: string;
  /** The work item; undefined while loading, when ADO can't be reached, or for a "No ticket" ticket. */
  workItem?: WorkItem;
  /** Shown instead of the work item chip ("No Azure DevOps work item", "Azure DevOps unavailable"). */
  note?: string;
  session?: {
    id: string | null;
    startedAt: number | null;
    now: number;
    usage?: AgentUsage;
    /** The live session status (AL-252): its state colours the pill; a lost or ended session offers Reconnect. */
    status?: AgentSessionStatus;
    onReconnect?: () => void;
    reconnecting?: boolean;
  };
  /** Controls right of the session pill: the usage strip and the Agent menu (AL-253, AL-257). */
  trailing?: ReactNode;
}

/**
 * The drill-in's header band (AL-250): one glass band with "← Board", the repo / #id breadcrumb, the
 * work item chip and "Open in Azure DevOps ↗" on the first row, the title on the second; the session
 * pill and the agent controls sit on the right. Everything the old top bar, meta row and display title
 * said, in about 90 px, so the transcript starts near the top of the window.
 */
export function TicketHeaderBand({ ticketId, title, repo, workItem, note, session, trailing }: TicketHeaderBandProps) {
  const { navigate } = useNavigation();
  const details = workItem
    ? [workItem.type, workItem.state, sprintName(workItem.iterationPath), workItem.assignedTo?.displayName].filter(Boolean).join(' · ')
    : note;

  return (
    <GlassPanel style={styles.band} testID="ticket-top-bar">
      <View style={styles.main}>
        <View style={styles.crumbs} testID="ticket-meta">
          <Button label="← Board" size="sm" onPress={() => navigate(routes.board())} />
          <View style={styles.repoMark} aria-hidden />
          <Text variant="body" numberOfLines={1} style={styles.breadcrumb} testID="ticket-breadcrumb">
            {repo ? <Text variant="body" color={color.muted}>{`${folderName(repo)} / `}</Text> : null}
            <Text variant="title">{`#${ticketId}`}</Text>
          </Text>
          {/^\d+$/.test(ticketId) ? null : <Pill label={ticketId} tone="neutral" />}
          {details ? (
            <View style={styles.metaChip}>
              <Text variant="body" size="sm" numberOfLines={1}>
                {details}
              </Text>
            </View>
          ) : null}
          {workItem ? (
            <Pressable
              role="link"
              aria-label="Open in Azure DevOps"
              onPress={() => void Linking.openURL(workItem.webUrl)}
              style={styles.adoLink}
              testID="open-in-ado"
            >
              <Text variant="title" size="sm" color={tone.ado.text}>
                Open in Azure DevOps
              </Text>
              <Icon name="arrow-up-right" color={tone.ado.text} size={14} />
            </Pressable>
          ) : null}
        </View>
        {title !== undefined ? (
          <Text variant="title" size="xl" role="heading" aria-level={1} numberOfLines={2} selectable style={styles.title} testID="ticket-title">
            {title || `#${ticketId}`}
          </Text>
        ) : null}
      </View>
      <View style={styles.side}>
        {session ? <SessionPill {...session} /> : null}
        {trailing}
      </View>
    </GlassPanel>
  );
}

/** How each session state reads on the pill (AL-252): its tone and the word after the id. */
export const SESSION_PILL_STATES: Readonly<Record<AgentSessionState, { tone: PillTone; word: string | null }>> = {
  none: { tone: 'neutral', word: null },
  starting: { tone: 'claude', word: 'starting' },
  running: { tone: 'ok', word: 'running' },
  idle: { tone: 'ok', word: 'idle' },
  paused: { tone: 'attention', word: 'paused' },
  queued: { tone: 'neutral', word: 'queued' },
  stopped: { tone: 'neutral', word: 'ended' },
  lost: { tone: 'danger', word: 'lost' },
};

function SessionPill({ id, startedAt, now, usage, status, onReconnect, reconnecting }: NonNullable<TicketHeaderBandProps['session']>) {
  const [open, setOpen] = useState(false);
  const state = status?.state ?? (id ? 'idle' : 'none');
  const view = SESSION_PILL_STATES[state];
  if (!id) return <Pill label={state === 'queued' ? 'Queued · waiting for a slot' : 'No session yet'} tone={view.tone} dot size="md" testID="session-pill" />;
  const base = sessionPillLabel(id, startedAt, now, usage);
  const label = view.word ? base.replace(/^Session (\S+)/, `Session $1 · ${view.word}`) : base;
  const details = [usage ? sessionUsageDetails(usage, id) : sessionUsageDetails(emptyAgentUsage(''), id), status?.message].filter(Boolean).join(' · ') || null;
  const ended = state === 'lost' || state === 'stopped';

  // Cost and the reason a session ended show in a tooltip only (AL-113, AL-252): on hover, or on focus for the keyboard.
  return (
    <View style={styles.sessionRow}>
      <Pressable
        aria-label={details ? `${label}. ${details}` : label}
        aria-describedby={details ? 'session-usage-tooltip' : undefined}
        onHoverIn={() => setOpen(true)}
        onHoverOut={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={styles.sessionAnchor}
        testID="session-pill-anchor"
      >
        <Pill label={label} tone={view.tone} dot size="md" testID="session-pill" />
        {open && details ? (
          <View role="tooltip" id="session-usage-tooltip" style={styles.tooltip} testID="session-usage-tooltip">
            <Text variant="body" size="sm" color={color.surface}>
              {details}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {ended && onReconnect ? <Button size="sm" variant="primary" icon="refresh" label="Reconnect" onPress={onReconnect} loading={reconnecting} testID="session-reconnect" /> : null}
    </View>
  );
}


const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: space.sm,
  },
  crumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  repoMark: {
    width: 20,
    height: 20,
    borderRadius: radius.chip - 2,
    backgroundColor: color.claude,
  },
  breadcrumb: {
    flexShrink: 1,
  },
  metaChip: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  adoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 28,
    paddingHorizontal: space.xs,
  },
  title: {
    lineHeight: 26,
  },
  side: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
    maxWidth: '55%',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  sessionAnchor: {
    position: 'relative',
  },
  tooltip: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: space.xs,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 2,
    borderRadius: radius.chip,
    backgroundColor: color.ink,
    zIndex: 10,
    minWidth: 220,
  },
});
