import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, fontWeight, radius, space, tone } from '@agent-lanes/tokens';
import { Card, Icon, type IconName } from '@agent-lanes/ui';
import { copyDiagnostics } from '@/shared/api';

export interface ErrorFallbackProps {
  /** What stopped working, as the user knows it: "Agent Lanes", "the board", "the Planning lane". */
  label: string;
  error: Error;
  /** Shows Retry when given. */
  onRetry?: () => void;
  /** `page` centres the panel in the space it replaces (app root, pages); `inline` fills a lane or panel. */
  variant?: 'page' | 'inline';
  testID?: string;
}

type CopyState = { kind: 'idle' } | { kind: 'copying' } | { kind: 'copied' } | { kind: 'failed'; message: string };

/**
 * What an error boundary shows instead of the part that failed (design §12, AL-214): what failed,
 * the error, Retry, and "Copy diagnostics" (versions, settings without secrets, recent errors).
 * Laid out like the error toast on the "Agent card states" artboard. AL-210 places boundaries around
 * pages, lanes and panels with this fallback.
 */
export function ErrorFallback({ label, error, onRetry, variant = 'inline', testID = 'error-fallback' }: ErrorFallbackProps) {
  const [copy, setCopy] = useState<CopyState>({ kind: 'idle' });

  async function onCopy() {
    setCopy({ kind: 'copying' });
    const result = await copyDiagnostics();
    setCopy(result.ok ? { kind: 'copied' } : { kind: 'failed', message: result.message });
  }

  const panel = (
    <Card tone="danger" testID={testID} style={variant === 'page' ? styles.pageCard : undefined}>
      <View role="alert" style={styles.body}>
        <View style={styles.iconTile}>
          <Icon name="alert" color={color.danger} size={18} />
        </View>
        <View style={styles.content}>
          <Text role="heading" aria-level={2} style={styles.title}>
            Something went wrong in {label}
          </Text>
          <Text style={styles.hint}>
            {onRetry ? 'Retry to load it again. ' : ''}If it keeps happening, copy the diagnostics into a bug report.
          </Text>
          <Text selectable style={styles.error} testID={`${testID}-error`}>
            {error.name && error.name !== 'Error' ? `${error.name}: ` : ''}
            {error.message || 'No message'}
          </Text>
          <View style={styles.actions}>
            {onRetry ? <ActionButton kind="primary" label="Retry" icon="refresh" onPress={onRetry} /> : null}
            <ActionButton
              kind="secondary"
              label={copy.kind === 'copying' ? 'Copying…' : copy.kind === 'copied' ? 'Copied' : 'Copy diagnostics'}
              icon={copy.kind === 'copied' ? 'check' : undefined}
              disabled={copy.kind === 'copying'}
              onPress={() => void onCopy()}
            />
          </View>
          <Text aria-live="polite" style={[styles.status, copy.kind === 'failed' ? styles.statusFailed : styles.statusOk]}>
            {copy.kind === 'copied'
              ? 'Diagnostics copied to the clipboard, with tokens left out.'
              : copy.kind === 'failed'
                ? `Couldn't copy diagnostics: ${copy.message}`
                : ''}
          </Text>
        </View>
      </View>
    </Card>
  );

  return variant === 'page' ? <View style={styles.page}>{panel}</View> : panel;
}

interface ActionButtonProps {
  kind: 'primary' | 'secondary';
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onPress: () => void;
}

/** Primary and secondary buttons as on the error toast; replaced by the Button primitive once AL-024 lands. */
function ActionButton({ kind, label, icon, disabled = false, onPress }: ActionButtonProps) {
  const textColor = kind === 'primary' ? color.surface : color.ink;
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => [styles.button, buttonStyles[kind], pressed && styles.pressed, disabled && styles.disabled]}
    >
      {icon ? <Icon name={icon} color={textColor} size={14} /> : null}
      <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  pageCard: {
    width: '100%',
    maxWidth: 560,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: radius.chip,
    backgroundColor: tone.danger.band,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: space.sm,
  },
  title: {
    color: color.ink,
    fontFamily: font.sans,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.heading,
  },
  hint: {
    color: color.muted,
    fontFamily: font.sans,
    fontSize: fontSize.md,
    fontWeight: fontWeight.body,
    lineHeight: 20,
  },
  error: {
    color: tone.danger.text,
    backgroundColor: tone.danger.wash,
    borderRadius: radius.chip,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs + 2,
    fontFamily: font.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.mono,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
  button: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  buttonText: {
    fontFamily: font.sans,
    fontSize: fontSize.md,
    fontWeight: fontWeight.heading,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.6,
  },
  status: {
    minHeight: 18,
    fontFamily: font.sans,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.body,
  },
  statusOk: {
    color: tone.ok.text,
  },
  statusFailed: {
    color: tone.danger.text,
  },
});

const buttonStyles = StyleSheet.create({
  primary: {
    backgroundColor: color.claude,
    borderColor: color.claude,
  },
  secondary: {
    backgroundColor: color.surface,
    borderColor: color.line,
  },
});
