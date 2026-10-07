import { StyleSheet, View } from 'react-native';
import type { DesignViewStatus, EmbedMode } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Pill, Text, type PillTone } from '@agent-lanes/ui';

export interface BrowserBarProps {
  /** "claude.ai/design · 71273 canvas"; null while no canvas is linked. */
  label: string | null;
  mode: EmbedMode;
  /** The webview's state; undefined before main has reported one. */
  status: DesignViewStatus | undefined;
  /** Reloads the canvas page; omitted when there is no live view. */
  onReload?: () => void;
  /** Opens the canvas in Claude in the OS browser; omitted when no canvas is linked. */
  onOpenExternal?: () => void;
  /** Shows the link form to replace or unlink the canvas (AL-193); omitted when there is nothing to change. */
  onChangeCanvas?: () => void;
}

const STATUS_PILLS: Record<DesignViewStatus, { label: string; tone: PillTone }> = {
  loading: { label: 'Webview · loading', tone: 'neutral' },
  'signed-in': { label: 'Webview · signed in', tone: 'ok' },
  'signed-out': { label: 'Webview · sign-in needed', tone: 'attention' },
  'load-failed': { label: "Webview · couldn't load", tone: 'danger' },
};

/** What the status pill says, by mode and view state (AL-192 scope update). */
export function statusPill(mode: EmbedMode, status: DesignViewStatus | undefined): { label: string; tone: PillTone } {
  if (mode === 'mcp-link') return { label: 'MCP link · opens in Claude', tone: 'claude' };
  return STATUS_PILLS[status ?? 'loading'];
}

/** The browser-like bar over the canvas (artboard 4): dots, the canvas label, status, reload and pop-out. */
export function BrowserBar({ label, mode, status, onReload, onOpenExternal, onChangeCanvas }: BrowserBarProps) {
  const pill = label ? statusPill(mode, status) : null;

  return (
    <View style={styles.bar} testID="design-browser-bar">
      <View style={styles.dots} aria-hidden>
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>
      <View style={styles.address}>
        <Text variant="body" numberOfLines={1} color={label ? color.ink : color.muted} testID="design-canvas-label">
          {label ?? 'No canvas linked'}
        </Text>
      </View>
      {pill ? <Pill label={pill.label} tone={pill.tone} size="md" testID="design-view-status" /> : null}
      {onChangeCanvas ? <Button label="Change canvas" size="sm" onPress={onChangeCanvas} testID="design-change-canvas" /> : null}
      <Button label="Reload canvas" icon="refresh" iconOnly size="sm" disabled={!onReload} onPress={onReload} testID="design-reload" />
      <Button
        label="Open in Claude"
        icon="external-link"
        iconOnly
        size="sm"
        disabled={!onOpenExternal}
        onPress={onOpenExternal}
        testID="design-open-external"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: tone.neutral.dot,
    opacity: 0.6,
  },
  address: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    backgroundColor: color.bg,
  },
});
