import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ChangedFile } from '@agent-lanes/contracts';
import { color, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Pill, SegmentedControl, Switch, Text } from '@agent-lanes/ui';
import type { AgentView } from '@/entities/agent';
import { authorOf, changeTotals } from '@/entities/diff-file';
import type { DiffView } from '@/shared/model';
import { shownFile } from '../model/change-map';
import { ChangeMap } from './ChangeMap';

export interface DiffColumnProps {
  files: readonly ChangedFile[];
  agents: readonly AgentView[];
  /** `selectedFilePath`: the file picked on a tile (or in Code City); null shows the biggest change. */
  selectedFilePath: string | null;
  onSelectFile(path: string): void;
  loading: boolean;
  error: { message: string } | null;
  onRetry(): void;
  followAgent: boolean;
  onFollowChange(follow: boolean): void;
  /** The file a running agent last edited or reviewed, which Follow agent selects. */
  latestActivityPath: string | null;
  diffMode: DiffView;
  onDiffModeChange(mode: DiffView): void;
  /** The diff body: the page's per-file diff renderer, told the author's colour for the stripe. */
  renderDiff(file: ChangedFile, mode: DiffView, stripeColor: string): ReactNode;
  /** The column's height when the page scrolls as a whole; otherwise the column fills the row. */
  height?: number;
}

const VIEW_OPTIONS = [
  { value: 'unified' as const, label: 'Unified' },
  { value: 'split' as const, label: 'Split' },
];

/**
 * The diff column (handoff "Flight deck > Diff column"): "Ticket branch vs base" with the file count and +/−
 * totals, the Follow agent switch and the Unified / Split segments; the change map; then the selected file's
 * header (a colour dot, its path, "by {agent}", +/−) and its diff with a 4 px author stripe on every changed line.
 * With nothing selected it shows the file with the biggest change. With Follow agent on, the selection moves to the
 * file a running agent last edited.
 */
export function DiffColumn({
  files,
  agents,
  selectedFilePath,
  onSelectFile,
  loading,
  error,
  onRetry,
  followAgent,
  onFollowChange,
  latestActivityPath,
  diffMode,
  onDiffModeChange,
  renderDiff,
  height,
}: DiffColumnProps) {
  const totals = useMemo(() => changeTotals(files), [files]);
  const shown = useMemo(() => shownFile(files, selectedFilePath), [files, selectedFilePath]);
  const paths = useMemo(() => new Set(files.map((file) => file.path)), [files]);
  const uncommitted = files.some((file) => file.uncommitted);

  // Follow agent: the selection jumps to the file under the newest edit or review. It fires when that file changes or
  // when Follow turns on, so a click on another tile sticks until the agent moves on.
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!followAgent) {
      followed.current = null;
      return;
    }
    if (latestActivityPath && latestActivityPath !== followed.current && paths.has(latestActivityPath)) {
      followed.current = latestActivityPath;
      onSelectFile(latestActivityPath);
    }
  }, [followAgent, latestActivityPath, paths, onSelectFile]);

  const author = shown ? authorOf(shown, agents) : null;
  return (
    <View style={[styles.column, height !== undefined ? { height, flexGrow: 0, flexShrink: 0 } : null]} testID="ticket-tab-diff">
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Text variant="title" size="md" role="heading" aria-level={2}>
            Ticket branch vs base
          </Text>
          {files.length > 0 ? (
            <Text variant="meta" size="sm" testID="diff-totals">
              {`${totals.files} ${totals.files === 1 ? 'file' : 'files'} · +${totals.added} −${totals.removed}`}
            </Text>
          ) : null}
          {uncommitted ? <Pill label="Includes uncommitted changes" tone="attention" testID="diff-uncommitted" /> : null}
        </View>
        <View style={styles.controls}>
          <Switch label="Follow agent" value={followAgent} onValueChange={onFollowChange} style={styles.follow} testID="diff-follow" />
          <SegmentedControl label="Diff view" options={VIEW_OPTIONS} value={diffMode} onChange={onDiffModeChange} testID="diff-view" />
        </View>
      </View>

      <ChangeMap files={files} agents={agents} selectedPath={shown?.path ?? null} onSelectFile={onSelectFile} loading={loading} error={error} onRetry={onRetry} />

      {shown && author ? (
        <View style={styles.file} testID="diff-file-panel">
          <View style={styles.fileHeader} testID="diff-file-header">
            <View style={[styles.dot, { backgroundColor: author.color }]} aria-hidden />
            <View style={styles.fileName}>
              <Text variant="mono" size="sm" numberOfLines={1} selectable testID="diff-file-path">
                {shown.path}
              </Text>
              {shown.kind === 'renamed' && shown.oldPath ? (
                <Text variant="meta" size="xs" numberOfLines={1}>{`renamed from ${shown.oldPath}`}</Text>
              ) : null}
            </View>
            <Text variant="meta" size="sm" color={color.ink} numberOfLines={1} testID="diff-file-author">
              {`by ${author.name}`}
            </Text>
            {shown.kind === 'binary' ? (
              <Text variant="meta" size="sm">
                binary
              </Text>
            ) : (
              <View style={styles.counts}>
                <Text variant="mono" size="sm" color={tone.ok.text}>{`+${shown.added}`}</Text>
                <Text variant="mono" size="sm" color={tone.danger.text}>{`−${shown.removed}`}</Text>
              </View>
            )}
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} testID="diff-file-body">
            {shown.kind === 'binary' ? (
              <Text variant="meta" size="md" style={styles.note}>
                Binary file — no diff.
              </Text>
            ) : (
              renderDiff(shown, diffMode, author.color)
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    gap: space.md,
    padding: space.md,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
  },
  head: {
    gap: space.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  follow: {
    paddingHorizontal: 0,
    gap: space.sm,
  },
  file: {
    flex: 1,
    minHeight: 160,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    backgroundColor: color.bg,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  fileName: {
    flex: 1,
    minWidth: 0,
  },
  counts: {
    flexDirection: 'row',
    gap: space.sm,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  bodyContent: {
    paddingVertical: 0,
  },
  note: {
    padding: space.md,
  },
});
