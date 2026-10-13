import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { ChangedFile } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import type { AgentView } from '@/entities/agent';
import { usePrefersReducedMotion } from '@/shared/lib';
import { ADDED_COLOR, BINARY_BAR_COLOR, REMOVED_COLOR, TILE_BAR_HEIGHT, TILE_HEIGHT, TILE_MIN_WIDTH, changeTiles, legendEntries, type ChangeTile } from '../model/change-map';
import { HoverHint } from './HoverHint';
import { pulseStyle, web } from './motion';

export interface ChangeMapProps {
  files: readonly ChangedFile[];
  agents: readonly AgentView[];
  /** The file whose diff is shown: its tile has the ring. */
  selectedPath: string | null;
  onSelectFile(path: string): void;
  loading: boolean;
  /** `diff:files` failed: an inline error with Retry. */
  error: { message: string } | null;
  onRetry(): void;
}

/**
 * The change map (handoff "Flight deck > Diff column"): one tile per changed file, the biggest change first and
 * as wide as the lines it changed, tinted with its author's colour and carrying a green and red bar of what it
 * added and removed. A click selects it; the selected tile has a 2 px ring in its author's colour. A legend of the
 * agent colours sits under the tiles. More than 40 files scroll sideways.
 */
export function ChangeMap({ files, agents, selectedPath, onSelectFile, loading, error, onRetry }: ChangeMapProps) {
  const reduced = usePrefersReducedMotion();
  if (error) {
    return (
      <View style={styles.note} role="alert" testID="change-map-error">
        <Text variant="meta" size="md" color={tone.danger.text}>
          {`Couldn't load the changed files. ${error.message}`}
        </Text>
        <Button label="Retry" size="sm" onPress={onRetry} style={styles.retry} testID="change-map-retry" />
      </View>
    );
  }
  if (loading && files.length === 0) {
    return (
      <View style={styles.row} aria-busy testID="change-map-loading">
        {[3, 2, 2, 1, 1].map((grow, index) => (
          <View key={index} style={[styles.skeleton, { flexGrow: grow }, reduced ? null : pulseStyle]} />
        ))}
      </View>
    );
  }
  if (files.length === 0) {
    return (
      <Text variant="meta" size="md" style={styles.note} testID="change-map-empty">
        No changes against the base yet.
      </Text>
    );
  }

  const tiles = changeTiles(files, agents);
  const legend = legendEntries(files, agents);
  return (
    <View style={styles.map} testID="change-map">
      <ScrollView horizontal showsHorizontalScrollIndicator={files.length > 40} contentContainerStyle={styles.row} role="group" aria-label="Changed files">
        {tiles.map((tile) => (
          <Tile key={tile.path} tile={tile} selected={tile.path === selectedPath} onPress={() => onSelectFile(tile.path)} />
        ))}
      </ScrollView>
      <View style={styles.legend} testID="change-map-legend">
        <View style={styles.legendEntries}>
          {legend.map((entry) => (
            <View key={entry.key} style={styles.legendEntry}>
              <View style={[styles.swatch, { backgroundColor: entry.color }]} aria-hidden />
              <Text variant="meta" size="xs" color={color.ink}>
                {entry.name}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="meta" size="xs">
          width = lines changed
        </Text>
      </View>
    </View>
  );
}

function Tile({ tile, selected, onPress }: { tile: ChangeTile; selected: boolean; onPress(): void }) {
  return (
    <HoverHint hint={tile.tooltip} style={{ flexGrow: tile.grow, flexShrink: 0, flexBasis: TILE_MIN_WIDTH, minWidth: TILE_MIN_WIDTH }}>
      <Pressable
        role="button"
        aria-label={tile.label}
        aria-pressed={selected}
        onPress={onPress}
        style={[styles.tile, { backgroundColor: tile.tint }, selected && web({ boxShadow: `0 0 0 2px ${tile.authorColor}` }), selected && { borderColor: tile.authorColor }]}
        testID={`change-tile-${tile.path}`}
      >
        <Text variant="body" size="xs" numberOfLines={1} style={styles.name}>
          {tile.renamed ? `↷ ${tile.name}` : tile.name}
        </Text>
        {tile.binary ? (
          <Text variant="meta" size="xs" numberOfLines={1}>
            binary
          </Text>
        ) : null}
        <View style={styles.bar} aria-hidden>
          {tile.binary ? (
            <View style={{ flex: 1, backgroundColor: BINARY_BAR_COLOR }} />
          ) : (
            <>
              {tile.addedPercent > 0 ? <View style={{ flex: tile.addedPercent, backgroundColor: ADDED_COLOR }} /> : null}
              {tile.removedPercent > 0 ? <View style={{ flex: tile.removedPercent, backgroundColor: REMOVED_COLOR }} /> : null}
              {tile.addedPercent === 0 && tile.removedPercent === 0 ? <View style={{ flex: 1, backgroundColor: BINARY_BAR_COLOR }} /> : null}
            </>
          )}
        </View>
      </Pressable>
    </HoverHint>
  );
}

const styles = StyleSheet.create({
  map: {
    gap: space.sm,
  },
  row: {
    flexGrow: 1,
    flexDirection: 'row',
    gap: 4,
  },
  tile: {
    flex: 1,
    height: TILE_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingBottom: TILE_BAR_HEIGHT,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  name: {
    fontWeight: '700',
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: TILE_BAR_HEIGHT,
    flexDirection: 'row',
  },
  skeleton: {
    flexBasis: TILE_MIN_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: radius.control,
    backgroundColor: color.line,
  },
  note: {
    gap: space.sm,
    paddingVertical: space.sm,
  },
  retry: {
    alignSelf: 'flex-start',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  legendEntries: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  legendEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
});
