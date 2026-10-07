import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, glass, radius, shadow, space, type ColorToken, type GlassLevel } from '@agent-lanes/tokens';
import { Button, GlassPanel, Text } from '@agent-lanes/ui';
import { GalleryBlock, GalleryRow, GallerySheet } from './GallerySection';

/** The colour swatches on artboard 7, in its order, plus the two tokens the artboard leaves out. */
const swatches: readonly { token: ColorToken; name: string; use: string }[] = [
  { token: 'bg', name: 'bg', use: 'App ground' },
  { token: 'surface', name: 'surface', use: 'Cards, panels' },
  { token: 'ink', name: 'ink', use: 'Headings, strong buttons' },
  { token: 'muted', name: 'muted', use: 'Meta text' },
  { token: 'line', name: 'line', use: 'Borders, dividers' },
  { token: 'claude', name: 'claude', use: 'Agent activity, primary' },
  { token: 'claudeTint', name: 'claude-tint', use: 'Agent chips, active' },
  { token: 'ado', name: 'ado', use: 'Azure DevOps ids' },
  { token: 'adoTint', name: 'ado-tint', use: 'ADO chips' },
  { token: 'ok', name: 'ok', use: 'Done, online' },
  { token: 'attention', name: 'attention', use: 'Needs you (sparingly)' },
  { token: 'skyGlow', name: 'sky glow', use: 'Glass backdrop, progress' },
  { token: 'claudeText', name: 'claude-text', use: 'Text on claude tint' },
  { token: 'danger', name: 'danger', use: 'Failures' },
];

const glassLevels: readonly { level: GlassLevel; blur: number; use: string }[] = [
  { level: 'sm', blur: glass.blurSm, use: 'chips, toolbar buttons' },
  { level: 'md', blur: glass.blurMd, use: 'panels, header, live dock' },
  { level: 'xl', blur: glass.blurXl, use: 'modals and sheets' },
];

const radii: readonly { value: number; name: string }[] = [
  { value: radius.chip, name: 'chip' },
  { value: radius.control, name: 'control' },
  { value: radius.card, name: 'card' },
  { value: radius.panel, name: 'panel' },
  { value: radius.modal, name: 'modal' },
];

/** Artboard 7, "Design tokens": colours, liquid glass levels, type, radii and the button variants. */
export function TokensSheet() {
  return (
    <GallerySheet
      kicker="agent-lanes-tokens.css"
      title="Design tokens"
      aside={'Soft corporate: cool palette, rounded surfaces, light liquid glass. Glass recipe adapted from "Pure CSS Glassmorphism Liquid Glass UI Kit" by Margarita-the-solid on CodePen.'}
      testID="gallery-tokens"
    >
      <GalleryBlock title="Colour" rule>
        <GalleryRow style={styles.swatches}>
          {swatches.map((swatch) => (
            <View key={swatch.token} style={styles.swatch} testID={`gallery-swatch-${swatch.token}`}>
              <View style={[styles.swatchColour, { backgroundColor: color[swatch.token] }]} />
              <View style={styles.swatchText}>
                <Text variant="title" size="sm">
                  {swatch.name}
                </Text>
                <Text variant="mono" size="xs" color={color.muted}>
                  {color[swatch.token]}
                </Text>
                <Text variant="meta">{swatch.use}</Text>
              </View>
            </View>
          ))}
        </GalleryRow>
      </GalleryBlock>

      <GalleryBlock title="Liquid glass" rule>
        <View style={styles.glassStage}>
          <View aria-hidden style={[styles.glow, styles.glowViolet, softBlur]} />
          <View aria-hidden style={[styles.glow, styles.glowMint, softBlur]} />
          <View aria-hidden style={[styles.glow, styles.glowSky, softBlur]} />
          {glassLevels.map(({ level, blur, use }) => (
            <GlassPanel key={level} level={level} style={styles.glassPanel} testID={`gallery-glass-${level}`}>
              <Text variant="title" size="lg">
                {`--blur-${level}`}
              </Text>
              <Text variant="meta" size="md">{`${blur}px · ${use}`}</Text>
            </GlassPanel>
          ))}
        </View>
      </GalleryBlock>

      <View style={styles.columns}>
        <GalleryBlock title="Type" rule style={styles.column}>
          <Text variant="display">Plus Jakarta Sans 800</Text>
          <Text variant="title" size="xl">
            Plus Jakarta Sans 700 — card titles, panel headings
          </Text>
          <Text variant="body">Plus Jakarta Sans 500 — body, labels, controls</Text>
          <Text variant="mono" size="md">
            JetBrains Mono 400 — IDs, branches, logs, diffs
          </Text>
        </GalleryBlock>

        <GalleryBlock title="Radius, shadow, controls" rule style={styles.column}>
          <GalleryRow style={styles.radii}>
            {radii.map(({ value, name }) => (
              <View key={name} style={styles.radiusSample}>
                <View style={[styles.radiusBox, { borderRadius: value }]} />
                <Text variant="mono" size="xs" color={color.muted}>{`${value} · ${name}`}</Text>
              </View>
            ))}
          </GalleryRow>
          <GalleryRow>
            <Button label="Primary" variant="primary" />
            <Button label="Strong" variant="strong" />
            <Button label="Secondary" variant="secondary" />
            <Button label="Soft pill" variant="soft" />
          </GalleryRow>
          <Text variant="meta">Motion: ease-out 150–220ms; hover lifts 3px with a deeper soft shadow. No skew, no hard offset shadows.</Text>
        </GalleryBlock>
      </View>
    </GallerySheet>
  );
}

/** Web-only: the soft colour glows behind the glass samples, as on the artboard. */
const softBlur = { filter: 'blur(48px)' } as unknown as ViewStyle;

const styles = StyleSheet.create({
  swatches: {
    alignItems: 'stretch',
  },
  swatch: {
    width: 160,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
    overflow: 'hidden',
  },
  swatchColour: {
    height: 72,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  swatchText: {
    padding: space.md,
    gap: 2,
  },
  glassStage: {
    flexDirection: 'row',
    gap: space.xl,
    padding: space.xxl,
    borderRadius: radius.panel,
    backgroundColor: '#E8EDF5',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 360,
    height: 220,
    borderRadius: radius.pill,
  },
  glowViolet: {
    left: 60,
    top: 40,
    backgroundColor: 'rgba(91, 75, 196, 0.45)',
  },
  glowMint: {
    left: '42%',
    top: 90,
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
  },
  glowSky: {
    right: 20,
    top: 30,
    backgroundColor: 'rgba(56, 189, 248, 0.55)',
  },
  glassPanel: {
    flex: 1,
    minHeight: 160,
    padding: space.xl,
    gap: space.xs,
  },
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xxl,
  },
  column: {
    flex: 1,
    minWidth: 420,
  },
  radii: {
    alignItems: 'flex-start',
  },
  radiusSample: {
    alignItems: 'center',
    gap: space.sm,
  },
  radiusBox: {
    width: 56,
    height: 56,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    boxShadow: shadow.card,
  },
});
