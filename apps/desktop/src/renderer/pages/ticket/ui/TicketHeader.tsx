import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { WorkItem } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, GlassPanel, Icon, IdChip, Pill, Text } from '@agent-lanes/ui';
import { routes, useNavigation } from '@/shared/routing';
import { folderName, formatDuration, sprintName } from '../lib/format';

export interface TicketTopBarProps {
  ticketId: string;
  /** The repo's main checkout; its folder name starts the breadcrumb. Undefined while unknown. */
  repo?: string;
  session?: { id: string | null; startedAt: number | null; now: number };
}

/** "← Board", the repo / #id breadcrumb and the session pill (artboard 3 top bar). */
export function TicketTopBar({ ticketId, repo, session }: TicketTopBarProps) {
  const { navigate } = useNavigation();

  return (
    <GlassPanel style={styles.topBar} testID="ticket-top-bar">
      <Button label="← Board" size="sm" onPress={() => navigate(routes.board())} />
      <View style={styles.repoMark} aria-hidden />
      <Text variant="body" numberOfLines={1} style={styles.breadcrumb} testID="ticket-breadcrumb">
        {repo ? <Text variant="body" color={color.muted}>{`${folderName(repo)} / `}</Text> : null}
        <Text variant="title">{`#${ticketId}`}</Text>
      </Text>
      <View style={styles.spacer} />
      {session ? <SessionPill {...session} /> : null}
    </GlassPanel>
  );
}

function SessionPill({ id, startedAt, now }: { id: string | null; startedAt: number | null; now: number }) {
  if (!id) return <Pill label="No session yet" tone="neutral" dot size="md" testID="session-pill" />;
  const label = startedAt === null ? `Session ${id}` : `Session ${id} · ${formatDuration(now - startedAt)}`;
  return <Pill label={label} tone="ok" dot size="md" testID="session-pill" />;
}

export interface TicketMetaProps {
  ticketId: string;
  /** The work item; undefined while loading, when ADO can't be reached, or for a "No ticket" ticket. */
  workItem?: WorkItem;
  /** Shown instead of the work item line ("No Azure DevOps work item", "Azure DevOps unavailable"). */
  note?: string;
}

/** `#71273`, "User story · Active · Sprint 42 · Kyle Richards" and "Open in Azure DevOps ↗" (artboard 3). */
export function TicketMeta({ ticketId, workItem, note }: TicketMetaProps) {
  const details = workItem
    ? [workItem.type, workItem.state, sprintName(workItem.iterationPath), workItem.assignedTo?.displayName].filter(Boolean).join(' · ')
    : note;

  return (
    <View style={styles.meta} testID="ticket-meta">
      {/^\d+$/.test(ticketId) ? <IdChip id={ticketId} style={styles.idChip} /> : <Pill label={ticketId} tone="neutral" />}
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
          <Text variant="title" color={tone.ado.text}>
            Open in Azure DevOps
          </Text>
          <Icon name="arrow-up-right" color={tone.ado.text} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  repoMark: {
    width: 28,
    height: 28,
    borderRadius: radius.chip,
    backgroundColor: color.claude,
  },
  breadcrumb: {
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  idChip: {
    alignSelf: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  metaChip: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  adoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 32,
    paddingHorizontal: space.xs,
  },
});
