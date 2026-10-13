import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { GlassPanel, Icon } from '@agent-lanes/ui';
import { authorOf } from '../model/cityData';
import { commonDirPrefix, districtKey, districtLabel, layoutCity } from '../model/layoutCity';
import type { CodeCityProps } from '../model/types';
import { CityScene } from './CityScene';
import { CrewPanel } from './CrewPanel';
import { HowToCard } from './HowToCard';
import { InspectorRail } from './InspectorRail';
import { StageTrack } from './StageTrack';

/** Below this window width the inspector rail becomes a bottom sheet. */
export const NARROW_BELOW = 1200;
const RAIL_WIDTH = 450;

/**
 * Code City: an isometric 3D city of the ticket's changed files with a crew panel, a stage track, a composer and an
 * inspector rail. Presentational: the ticket page owns the store and IPC wiring and passes everything in.
 */
export function CodeCity(props: CodeCityProps) {
  const { files, base, loading, error, onRetry, agents, reviewStatus, findings, selectedFilePath, onSelectFile, followAgent, latestActivityPath } = props;
  const { diffMode, onDiffModeChange, stages, legendDismissed, onDismissLegend, renderDiff, composer, worktree, onOpenPrThread, testID } = props;
  const { width } = useWindowDimensions();
  const narrow = width < NARROW_BELOW;

  const layout = useMemo(() => layoutCity(files), [files]);
  const paths = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const prefix = useMemo(() => commonDirPrefix(files.map((f) => f.path)), [files]);
  const selected = useMemo(() => files.find((f) => f.path === selectedFilePath) ?? null, [files, selectedFilePath]);
  const anyUncommitted = useMemo(() => files.some((f) => f.uncommitted), [files]);
  const noteFindings = useMemo(() => findings.filter((f) => f.filePath === selectedFilePath), [findings, selectedFilePath]);
  const author = authorOf(selected ?? { authorAgentId: null }, agents);

  // Follow agent: the selection jumps to the building under the latest edit or review activity. Turning Follow
  // off is the caller's job and sticky; the effect only fires when the activity path changes or Follow turns on.
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

  const rail = (
    <InspectorRail
      loading={loading && files.length === 0}
      file={selected}
      author={author}
      district={selected ? districtLabel(districtKey(selected.path, prefix)) : ''}
      review={selected ? (reviewStatus[selected.path] ?? 'notReviewed') : 'notReviewed'}
      anyUncommitted={anyUncommitted}
      findings={noteFindings}
      diffMode={diffMode}
      onDiffModeChange={onDiffModeChange}
      renderDiff={renderDiff}
      worktree={worktree}
      onOpenPrThread={onOpenPrThread}
    />
  );

  return (
    <View style={[styles.root, narrow ? null : styles.wide]} testID={testID ?? 'code-city'}>
      <View style={styles.left}>
        <View style={styles.sceneHost}>
          <CityScene
            layout={layout}
            files={files}
            agents={agents}
            reviewStatus={reviewStatus}
            selectedFilePath={selectedFilePath}
            onSelectFile={onSelectFile}
            base={base}
            loading={loading}
            error={error}
            onRetry={onRetry}
          />
          {legendDismissed ? null : <HowToCard onDismiss={onDismissLegend} />}
          <CrewPanel agents={agents} paths={paths} onSelectFile={onSelectFile} />
        </View>
        <StageTrack stages={stages} />
        {composer}
      </View>
      {narrow ? (
        selected ? (
          <GlassPanel level="xl" style={styles.sheet} testID="city-sheet">
            <Pressable role="button" aria-label="Close the inspector" onPress={() => onSelectFile(null)} style={styles.sheetClose} hitSlop={8}>
              <Icon name="close" size={16} />
            </Pressable>
            <View style={styles.sheetBody}>{rail}</View>
          </GlassPanel>
        ) : null
      ) : (
        <View style={styles.right}>{rail}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, position: 'relative', gap: space.md },
  wide: { flexDirection: 'row' },
  left: { flex: 1, minWidth: 0, gap: space.md },
  sceneHost: { flex: 1, minHeight: 560, position: 'relative' },
  right: { width: RAIL_WIDTH, minHeight: 0 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%', padding: space.md, zIndex: 20 },
  sheetClose: { position: 'absolute', top: 10, right: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  sheetBody: { flex: 1, minHeight: 0 },
});

export default CodeCity;
