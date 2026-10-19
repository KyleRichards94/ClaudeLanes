import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { ChangedFile, ReviewFinding, ReviewStatus } from '@agent-lanes/contracts';
import { color, space } from '@agent-lanes/tokens';
import { Card, Icon, SegmentedControl, Text } from '@agent-lanes/ui';
import type { Author } from '../model/cityData';
import { BuildingInspector } from './BuildingInspector';
import { InspectorNotes } from './InspectorNotes';

export interface InspectorRailProps {
  loading: boolean;
  file: ChangedFile | null;
  author: Author;
  district: string;
  review: ReviewStatus;
  anyUncommitted: boolean;
  findings: readonly ReviewFinding[];
  diffMode: 'unified' | 'split';
  onDiffModeChange(mode: 'unified' | 'split'): void;
  renderDiff(file: ChangedFile, mode: 'unified' | 'split', stripeColor: string): ReactNode;
  worktree: ReactNode;
  onOpenPrThread?(threadId: number): void;
  /**
   * Which cards this rail draws: all of them (the default), only the Blueprint diff, or everything but it. Expanding the
   * diff draws it as its own pane beside the city, and the rest stays in the right rail.
   */
  part?: 'all' | 'diff' | 'rest';
  /** The diff pane is out of the rail, beside the city; the button on its header puts it back. Absent hides the button. */
  expanded?: boolean;
  onToggleExpand?(): void;
}

const MODES = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const;

function SkeletonRows() {
  return (
    <View style={styles.skeleton} testID="city-rail-skeleton" aria-busy>
      {[60, 100, 85, 100, 70, 90].map((width, index) => (
        <View key={index} style={[styles.bar, { width: `${width}%` }]} />
      ))}
    </View>
  );
}

/** The right rail: building card, blueprint diff, inspector's notes, worktree card. */
export function InspectorRail({ loading, file, author, district, review, anyUncommitted, findings, diffMode, onDiffModeChange, renderDiff, worktree, onOpenPrThread, part = 'all', expanded = false, onToggleExpand }: InspectorRailProps) {
  const showDiff = part !== 'rest';
  const showRest = part !== 'diff';
  return (
    <View style={styles.rail} testID={part === 'diff' ? 'city-diff-pane' : 'city-rail'}>
      {loading ? (
        <Card style={styles.fill}>
          <SkeletonRows />
        </Card>
      ) : (
        <>
          {showRest ? <BuildingInspector file={file} author={author} district={district} review={review} anyUncommitted={anyUncommitted} /> : null}
          {showDiff ? (
            <Card style={[styles.card, styles.diffCard]} testID="city-diff">
              <View style={styles.diffHead}>
                <Text variant="title" size="md" style={styles.bold}>
                  Blueprint diff
                </Text>
                <View style={styles.diffTools}>
                  <SegmentedControl options={MODES} value={diffMode} onChange={onDiffModeChange} label="Diff mode" />
                  {onToggleExpand ? (
                    <Pressable
                      role="button"
                      aria-label={expanded ? 'Move the blueprint diff back to the rail' : 'Expand the blueprint diff beside the city'}
                      aria-pressed={expanded}
                      onPress={onToggleExpand}
                      style={styles.expand}
                      testID="city-diff-expand"
                    >
                      <Icon name={expanded ? 'collapse' : 'expand'} size={16} color={color.ink} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {file ? (
                <Text variant="meta" size="xs" numberOfLines={1} selectable>
                  {file.path}
                </Text>
              ) : null}
              <ScrollView style={styles.fill} contentContainerStyle={styles.diffBody}>
                {!file ? (
                  <Text variant="meta">Select a building to see its diff.</Text>
                ) : file.kind === 'binary' ? (
                  <Text variant="meta">Binary file — no diff</Text>
                ) : (
                  renderDiff(file, diffMode, author.color)
                )}
              </ScrollView>
            </Card>
          ) : null}
          {showRest ? (
            <ScrollView style={styles.notes}>
              <InspectorNotes findings={findings} onOpenPrThread={onOpenPrThread} />
            </ScrollView>
          ) : null}
        </>
      )}
      {showRest ? worktree : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { flex: 1, gap: space.md },
  fill: { flex: 1, minHeight: 0 },
  card: { padding: space.md, gap: space.sm },
  // Never squeezed to a sliver by the cards around it: the rail grows and the page scrolls instead.
  diffCard: { flex: 1, minHeight: 280 },
  bold: { fontWeight: '800' },
  diffHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  diffTools: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  expand: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  diffBody: { flexGrow: 1 },
  notes: { flexGrow: 0, flexShrink: 0, maxHeight: 220 },
  skeleton: { padding: space.md, gap: 12 },
  bar: { height: 14, borderRadius: 8, backgroundColor: color.line },
});
