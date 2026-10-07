import { Pressable, StyleSheet, View } from 'react-native';
import type { DesignViewStatus, EmbedMode } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import { SideSection } from './SideSection';

interface ModeOption {
  value: EmbedMode;
  title: string;
  detail: string;
  /** What the mode does, under the cards. */
  explanation: string;
}

export const EMBED_MODE_OPTIONS: readonly ModeOption[] = [
  {
    value: 'webview',
    title: 'Webview',
    detail: 'Electron WebContentsView',
    explanation: 'Loads the Design canvas in an Electron WebContentsView. A plain iframe is likely blocked by claude.ai frame headers.',
  },
  {
    value: 'mcp-link',
    title: 'MCP link',
    detail: 'Open in Claude, sync via MCP',
    explanation:
      "Opens the canvas in Claude in your browser. Agent Lanes reads its artboards through Claude Code's claude.ai login, which needs Design access: run `claude /design login` or allow it at claude.ai/design/settings.",
  },
];

/** True when the webview could not show a signed-in canvas, so MCP link mode is offered (AL-194). */
export function webviewSignInFailed(status: DesignViewStatus | undefined): boolean {
  return status === 'signed-out' || status === 'load-failed';
}

export interface EmbedModeSectionProps {
  mode: EmbedMode;
  onChange: (mode: EmbedMode) => void;
  /** The webview's state, to offer MCP link mode when it can't sign in. */
  status: DesignViewStatus | undefined;
}

/**
 * "Embed mode" (artboard 4, AL-194): Webview or MCP link, saved per ticket in the UI prefs. When the
 * webview lands on a sign-in page it can't get past (Google refuses embedded browsers, D113) or fails
 * to load, it explains why and offers MCP link mode.
 */
export function EmbedModeSection({ mode, onChange, status }: EmbedModeSectionProps) {
  const explanation = EMBED_MODE_OPTIONS.find((option) => option.value === mode)?.explanation;
  const offerFallback = mode === 'webview' && webviewSignInFailed(status);

  return (
    <SideSection title="Embed mode" testID="design-embed-mode">
      <View role="radiogroup" aria-label="Embed mode" style={styles.options}>
        {EMBED_MODE_OPTIONS.map((option) => {
          const selected = option.value === mode;
          return (
            <Pressable
              key={option.value}
              role="radio"
              aria-checked={selected}
              aria-label={`${option.title}, ${option.detail}`}
              onPress={() => {
                if (!selected) onChange(option.value);
              }}
              style={(state) => [styles.option, selected && styles.optionSelected, (state as { focused?: boolean }).focused && styles.focused]}
              testID={`embed-mode-${option.value}`}
            >
              <Text variant="title" color={selected ? color.claudeText : color.ink}>
                {option.title}
              </Text>
              <Text variant="meta" size="xs">
                {option.detail}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="meta" size="sm">
        {explanation}
      </Text>
      {offerFallback ? (
        <View role="alert" style={styles.fallback} testID="embed-mode-fallback">
          <Text variant="title" size="sm" color={tone.attention.text}>
            {status === 'load-failed' ? "The canvas couldn't load here." : 'Signing in inside the app is not working?'}
          </Text>
          <Text variant="meta" size="sm" color={tone.attention.text}>
            Google sign-in is refused inside apps, and some single sign-on pages are too. MCP link opens the canvas in Claude in your
            browser and reads its artboards through your Claude Code login instead.
          </Text>
          <Button label="Use MCP link" size="sm" onPress={() => onChange('mcp-link')} style={styles.fallbackAction} />
        </View>
      ) : null}
    </SideSection>
  );
}

const styles = StyleSheet.create({
  options: {
    flexDirection: 'row',
    gap: space.sm,
  },
  option: {
    flex: 1,
    minHeight: 60,
    gap: 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  optionSelected: {
    borderColor: tone.claude.border,
    backgroundColor: tone.claude.wash,
  },
  focused: {
    borderColor: color.claude,
    boxShadow: `0 0 0 2px ${color.claude}`,
  },
  fallback: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.control,
    backgroundColor: tone.attention.band,
  },
  fallbackAction: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
  },
});
