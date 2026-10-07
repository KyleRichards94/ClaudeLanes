import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DesignArtboard } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Text } from '@agent-lanes/ui';
import { useDesignArtboards } from '@/shared/api';
import { keepSelectedArtboards, toggleArtboard, useSelectedArtboards } from '@/shared/model';
import { SideSection } from './SideSection';

/** "1440×900"; null when the canvas gives no size. */
export function artboardSize(artboard: DesignArtboard): string | null {
  return artboard.width !== null && artboard.height !== null ? `${artboard.width}×${artboard.height}` : null;
}

export interface HandOffSectionProps {
  ticketId: string;
  /** The linked canvas; undefined when none is linked. */
  canvasUrl: string | undefined;
}

/**
 * "Hand off to agent" (artboard 4, AL-195): the canvas's artboards with names and sizes and a
 * checkbox each, read through the design session (D118). The list is read again when the tab shows,
 * when the window regains focus and on Refresh, so added and renamed artboards appear; picks of
 * artboards no longer on the canvas are dropped. Shipping the picked artboards is AL-197's.
 */
export function HandOffSection({ ticketId, canvasUrl }: HandOffSectionProps) {
  const query = useDesignArtboards(ticketId, canvasUrl);
  const selected = useSelectedArtboards(ticketId);
  const list = query.data;
  const artboards = list?.status === 'ok' ? list.artboards : undefined;

  useEffect(() => {
    if (artboards) keepSelectedArtboards(ticketId, artboards.map((artboard) => artboard.id));
  }, [ticketId, artboards]);

  const count = artboards ? selected.filter((id) => artboards.some((artboard) => artboard.id === id)).length : 0;

  return (
    <SideSection title="Hand off to agent" testID="design-hand-off">
      {canvasUrl ? (
        <View style={styles.toolbar}>
          <Text variant="meta" size="sm" aria-live="polite" testID="artboards-status">
            {query.isFetching ? 'Reading the canvas…' : artboards ? `${artboards.length} artboard${artboards.length === 1 ? '' : 's'}` : ''}
          </Text>
          <Button
            label="Refresh artboards"
            icon="refresh"
            iconOnly
            size="sm"
            loading={query.isFetching}
            onPress={() => void query.refetch()}
            testID="artboards-refresh"
          />
        </View>
      ) : null}

      {!canvasUrl ? (
        <Text variant="meta" size="sm">
          Link a canvas to pick the artboards the agent should build from.
        </Text>
      ) : query.isError ? (
        <Text variant="meta" size="sm" color={tone.danger.text} role="alert">
          {query.error.message}
        </Text>
      ) : list?.status === 'unavailable' ? (
        <Text variant="meta" size="sm" color={tone.attention.text} testID="artboards-unavailable">
          {list.reason}
        </Text>
      ) : artboards && artboards.length === 0 ? (
        <Text variant="meta" size="sm">
          No artboards on this canvas yet.
        </Text>
      ) : artboards ? (
        <View role="group" aria-label="Artboards to hand off" style={styles.list}>
          {artboards.map((artboard) => (
            <ArtboardRow
              key={artboard.id}
              artboard={artboard}
              checked={selected.includes(artboard.id)}
              onToggle={() => toggleArtboard(ticketId, artboard.id)}
            />
          ))}
        </View>
      ) : (
        <Text variant="meta" size="sm">
          Reading the canvas&apos;s artboards…
        </Text>
      )}

      <Button
        label={`Send ${count} artboard${count === 1 ? '' : 's'} to agent as spec`}
        variant="primary"
        trailingIcon="arrow-right"
        justify="between"
        disabled
        testID="send-artboards"
      />
      <Text variant="meta" size="sm">
        Attaches artboard source and tokens to the lead agent&apos;s next turn.
      </Text>
    </SideSection>
  );
}

function ArtboardRow({ artboard, checked, onToggle }: { artboard: DesignArtboard; checked: boolean; onToggle: () => void }) {
  const size = artboardSize(artboard);
  return (
    <Pressable
      role="checkbox"
      aria-checked={checked}
      aria-label={size ? `${artboard.name}, ${size}` : artboard.name}
      onPress={onToggle}
      style={(state) => [styles.row, checked && styles.rowChecked, (state as { focused?: boolean }).focused && styles.focused]}
      testID={`artboard-${artboard.id}`}
    >
      <View style={[styles.box, checked && styles.boxChecked]} aria-hidden>
        {checked ? <Icon name="check" color={color.surface} size={12} /> : null}
      </View>
      <Text variant="title" numberOfLines={1} style={styles.name}>
        {artboard.name}
      </Text>
      {size ? (
        <Text variant="mono" size="xs" color={color.muted}>
          {size}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -space.sm,
  },
  list: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  rowChecked: {
    borderColor: tone.claude.border,
    backgroundColor: tone.claude.wash,
  },
  focused: {
    boxShadow: `0 0 0 2px ${color.claude}`,
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: tone.neutral.dot,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  boxChecked: {
    borderColor: color.claude,
    backgroundColor: color.claude,
  },
  name: {
    flex: 1,
  },
});
