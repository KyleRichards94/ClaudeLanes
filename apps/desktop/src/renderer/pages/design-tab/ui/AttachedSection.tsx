import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { DESIGN_TOKENS_FILE, describeSpecDiff, designSpecStatus, diffSpecArtboards, type DesignSpecStatus, type TicketDesignSpec } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Pill, Text, type PillTone } from '@agent-lanes/ui';
import { useDesignSpec, useReshipDesignSpec } from '@/shared/api';
import { SideSection } from './SideSection';

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Sent / Used · 14:01 / Superseded (artboard 4). */
export function specStatus(spec: TicketDesignSpec, latestVersion: number): { label: string; tone: PillTone; status: DesignSpecStatus } {
  const status = designSpecStatus(spec, latestVersion);
  if (status === 'superseded') return { label: 'Superseded', tone: 'neutral', status };
  if (status === 'used') return { label: `Used · ${clock(spec.usedAt ?? 0)}`, tone: 'ok', status };
  return { label: 'Sent', tone: 'claude', status };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * "Attached to this ticket" (artboard 4, AL-199): every shipped design version, newest first, with
 * Sent / Used / Superseded, and the design-system file. The list comes from the ticket record, so it
 * survives restarts, and `design:spec` reads the record again, so the agent's acknowledgement shows
 * live. Opening a version shows its artboards and note, what changed from the version before, and
 * lets the user ship an older version again (it becomes the newest version).
 */
export function AttachedSection({ ticketId, specs }: { ticketId: string; specs: readonly TicketDesignSpec[] }) {
  const latest = specs.at(-1)?.version ?? 0;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <SideSection title="Attached to this ticket" testID="design-attached">
      {specs.length === 0 ? (
        <Text variant="meta" size="sm">
          Designs you send to the agent are listed here.
        </Text>
      ) : null}
      {[...specs].reverse().map((spec) => {
        const status = specStatus(spec, latest);
        const expanded = open === spec.version;
        return (
          <View key={spec.version} style={styles.item} testID={`design-spec-v${spec.version}`}>
            <Pressable
              role="button"
              aria-expanded={expanded}
              aria-label={`Design v${spec.version}, ${plural(spec.artboardCount, 'artboard')}, ${status.label}`}
              onPress={() => setOpen(expanded ? null : spec.version)}
              style={styles.row}
            >
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} color={color.muted} />
              <Text variant="body" numberOfLines={1} style={styles.rowText}>
                {`Design v${spec.version} · ${plural(spec.artboardCount, 'artboard')}`}
              </Text>
              <Pill label={status.label} tone={status.tone} testID={`design-spec-v${spec.version}-status`} />
            </Pressable>
            {expanded ? <SpecDetails ticketId={ticketId} spec={spec} latest={latest} /> : null}
          </View>
        );
      })}
      <View style={[styles.row, styles.divider]}>
        <Text variant="body" numberOfLines={1} style={styles.rowText}>
          {DESIGN_TOKENS_FILE}
        </Text>
        <Pill label="Design system" tone="ado" />
      </View>
    </SideSection>
  );
}

function SpecDetails({ ticketId, spec, latest }: { ticketId: string; spec: TicketDesignSpec; latest: number }) {
  const current = useDesignSpec(ticketId, spec.version);
  const previous = useDesignSpec(ticketId, spec.version > 1 ? spec.version - 1 : undefined);
  const reship = useReshipDesignSpec();
  const data = current.data;

  if (current.isPending) {
    return (
      <Text variant="meta" size="sm" aria-busy>
        Reading Design v{spec.version}…
      </Text>
    );
  }
  if (current.isError) {
    return (
      <Text variant="meta" size="sm" color={tone.danger.text} role="alert">
        {current.error.message}
      </Text>
    );
  }
  const diff = data && previous.data ? diffSpecArtboards(previous.data, data) : null;

  return (
    <View style={styles.details} testID={`design-spec-v${spec.version}-details`}>
      <Text variant="meta" size="sm">
        {`Approved by ${spec.approvedBy} · ${clock(spec.shippedAt)}${data?.reshipOf ? ` · v${data.reshipOf} shipped again` : ''}`}
      </Text>
      {data?.note ? (
        <Text variant="body" size="sm" selectable>
          {`“${data.note}”`}
        </Text>
      ) : null}
      <View role="list" aria-label={`Artboards in Design v${spec.version}`} style={styles.artboards}>
        {data?.artboards.map((artboard) => (
          <View key={artboard.id} role="listitem" style={styles.artboard}>
            <Text variant="body" size="sm" numberOfLines={1} style={styles.rowText}>
              {artboard.name}
            </Text>
            {artboard.width !== null && artboard.height !== null ? (
              <Text variant="mono" size="xs" color={color.muted}>{`${artboard.width}×${artboard.height}`}</Text>
            ) : null}
            {artboard.source === null ? (
              <Text variant="meta" size="xs">
                no source
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {diff ? (
        <Text variant="meta" size="sm" testID={`design-spec-v${spec.version}-diff`}>
          {describeSpecDiff(diff, spec.version - 1)}
        </Text>
      ) : null}
      {spec.version < latest ? (
        <Button
          label={`Ship v${spec.version} again`}
          size="sm"
          icon="refresh"
          loading={reship.isPending}
          onPress={() => reship.mutate({ ticketId, version: spec.version })}
          testID={`design-spec-v${spec.version}-reship`}
        />
      ) : null}
      {reship.isError ? (
        <Text variant="meta" size="sm" color={tone.danger.text} role="alert">
          {reship.error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  details: {
    gap: space.sm,
    paddingBottom: space.md,
    paddingLeft: space.lg,
  },
  artboards: {
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.control,
    backgroundColor: color.bg,
  },
  artboard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
