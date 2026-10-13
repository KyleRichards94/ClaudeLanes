import { StyleSheet, View, type ViewStyle } from 'react-native';
import type { ChangedFile, ReviewStatus } from '@agent-lanes/contracts';
import { color, space } from '@agent-lanes/tokens';
import { Card, Pill, Text } from '@agent-lanes/ui';
import { faceColors, REVIEW_WORDS, type Author } from '../model/cityData';
import { fileName } from '../model/layoutCity';

export interface BuildingInspectorProps {
  /** The selected file; null shows the "pick a building" prompt. */
  file: ChangedFile | null;
  author: Author;
  /** The file's district label ("ComponentLibrary / Pages"). */
  district: string;
  review: ReviewStatus;
  /** Some change in the ticket exists only in the working tree. */
  anyUncommitted: boolean;
}

const web = (style: Record<string, string>) => style as unknown as ViewStyle;

function StatTile({ value, label, background, ink, testID }: { value: string; label: string; background: string; ink: string; testID: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: background }]} testID={testID}>
      <Text variant="title" size="md" color={ink} style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="meta" size="xs" color={ink} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const reviewTone: Record<ReviewStatus, { background: string; ink: string }> = {
  notReviewed: { background: '#F1F5F9', ink: '#475569' },
  inReview: { background: '#EEEBFF', ink: '#4A3BB0' },
  passed: { background: '#ECFDF5', ink: '#047857' },
  changesRequested: { background: '#FFFBEB', ink: '#92400E' },
};

/** The building card: tile, file name, district and builder, and the three stat tiles. */
export function BuildingInspector({ file, author, district, review, anyUncommitted }: BuildingInspectorProps) {
  const chip = anyUncommitted ? <Pill label="Includes uncommitted changes" tone="attention" testID="city-uncommitted" /> : null;
  if (!file) {
    return (
      <Card style={styles.card} testID="city-inspector">
        <Text variant="title" size="md" style={styles.bold}>
          Select a building
        </Text>
        <Text variant="meta">Click a building to see its stats, diff and the reviewer’s notes.</Text>
        {chip}
      </Card>
    );
  }
  const faces = faceColors(author.color);
  const binary = file.kind === 'binary';
  const tone = reviewTone[review];
  return (
    <Card style={styles.card} testID="city-inspector">
      <View style={styles.head}>
        <View style={[styles.tile, web({ backgroundImage: `linear-gradient(135deg, ${faces.c1}, ${faces.c3})` })]} aria-hidden />
        <View style={styles.headText}>
          <Text variant="mono" size="md" style={styles.bold} numberOfLines={1} selectable>
            {fileName(file.path)}
          </Text>
          {file.kind === 'renamed' && file.oldPath ? (
            <Text variant="meta" size="xs" numberOfLines={1}>
              renamed from {file.oldPath}
            </Text>
          ) : null}
          <Text variant="meta" size="sm" numberOfLines={1}>
            {district} · built by {author.name}
          </Text>
        </View>
      </View>
      {binary ? (
        <Text variant="meta" size="sm" testID="city-binary">
          Binary file — no diff
        </Text>
      ) : null}
      <View style={styles.stats}>
        <StatTile testID="city-stat-added" value={`+${file.added}`} label="floors added" background="#ECFDF5" ink="#047857" />
        <StatTile testID="city-stat-removed" value={`−${file.removed}`} label="demolished" background="#FEF2F2" ink="#B91C1C" />
        <StatTile testID="city-stat-review" value={REVIEW_WORDS[review]} label="inspection" background={tone.background} ink={tone.ink} />
      </View>
      {chip}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: 44, height: 44, borderRadius: 12 },
  headText: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '800' },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, minWidth: 0, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  statValue: { fontWeight: '800', color: color.ink },
});
