import { useState } from 'react';
import { Pressable, StyleSheet, View, type KeyDownEvent, type StyleProp, type ViewStyle } from 'react-native';
import { color, minTarget, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text, TextField } from '@agent-lanes/ui';
import { useApplyModelNow } from '@/entities/agent-ticket';
import { useInterruptTurn, useSessionStatus } from '@/shared/api';
import { AGENT_MESSAGE_LIMIT, usePauseResume, useRunSkill, useSendMessage } from '../api/composer';
import { composerControls, isSendShortcut, type ComposerControls } from '../model/composer';

export interface ComposerProps {
  ticketId: string;
  /** The ticket's skills (record `skills`, picked on artboard 2), shown as `/skill-name` chips. */
  skills: readonly string[];
  /** A model or effort change waits for the next turn, so "Apply model now" has something to apply. */
  switching: boolean;
  style?: StyleProp<ViewStyle>;
}

export const COMPOSER_PLACEHOLDER = 'Message the agent — steer, answer, or add context';

/**
 * The Output card's footer (artboard 3, AL-176): skill shortcut chips and "Apply model now", the
 * message box, Pause / Resume and Send. Ctrl+Enter sends. "Steer now" sends the next message with
 * `priority: 'now'`, so it reaches the agent at the next tool call instead of after the turn.
 * Messages sent while paused are held by the session and delivered on Resume (AL-105); the
 * composer counts them so the user can see they are waiting.
 */
export function Composer({ ticketId, skills, switching, style }: ComposerProps) {
  const status = useSessionStatus(ticketId);
  const send = useSendMessage(ticketId);
  const runSkill = useRunSkill(ticketId);
  const { pause, resume } = usePauseResume(ticketId);
  const interrupt = useInterruptTurn(ticketId);
  const applyModel = useApplyModelNow();
  const [text, setText] = useState('');
  const [steerNow, setSteerNow] = useState(false);
  const [held, setHeld] = useState(0);

  const controls = composerControls({ state: status.data?.state, switching, held });

  // Held messages were delivered on Resume (or went with the session) once it is no longer paused.
  if (!controls.paused && held > 0) setHeld(0);

  const onSend = () => {
    const message = text;
    send.mutate(
      { text: message, now: steerNow },
      {
        onSuccess: ({ held: wasHeld }) => {
          setText((current) => (current === message ? '' : current));
          setSteerNow(false);
          if (wasHeld) setHeld((count) => count + 1);
        },
      },
    );
  };

  const failed = [send, runSkill, pause, resume, applyModel, interrupt].find((call) => call.isError)?.error;

  return (
    <ComposerView
      skills={skills}
      controls={controls}
      text={text}
      onChangeText={setText}
      steerNow={steerNow}
      onSteerNowChange={setSteerNow}
      onSend={onSend}
      onPauseResume={() => (controls.paused ? resume.mutate() : pause.mutate())}
      onStop={() => interrupt.mutate()}
      // A skill sent while paused waits for Resume like any message (AL-254).
      onRunSkill={(skill) => runSkill.mutate(skill, { onSuccess: ({ held: wasHeld }) => wasHeld && setHeld((count) => count + 1) })}
      onApplyModel={() => applyModel.mutate({ ticketId })}
      pending={{
        send: send.isPending,
        pause: pause.isPending || resume.isPending,
        stop: interrupt.isPending,
        skill: runSkill.isPending,
        applyModel: applyModel.isPending,
      }}
      error={failed ? (failed instanceof Error ? failed.message : String(failed)) : null}
      style={style}
    />
  );
}

export interface ComposerViewProps {
  skills: readonly string[];
  controls: ComposerControls;
  text: string;
  onChangeText(text: string): void;
  steerNow: boolean;
  onSteerNowChange(on: boolean): void;
  onSend(): void;
  onPauseResume(): void;
  /** Stop turn (AL-253): ends the running turn; the session stays live. */
  onStop?(): void;
  onRunSkill(skill: string): void;
  onApplyModel(): void;
  /** Calls in flight, so a second press does nothing before the first one returns. */
  pending?: { send?: boolean; pause?: boolean; stop?: boolean; skill?: boolean; applyModel?: boolean };
  /** Why the last call failed; shown in place of the note. */
  error?: string | null;
  style?: StyleProp<ViewStyle>;
}

/** The composer without its calls, for the component gallery's states. */
export function ComposerView({
  skills,
  controls,
  text,
  onChangeText,
  steerNow,
  onSteerNowChange,
  onSend,
  onPauseResume,
  onStop,
  onRunSkill,
  onApplyModel,
  pending = {},
  error = null,
  style,
}: ComposerViewProps) {
  const canSend = text.trim().length > 0 && !pending.send;
  const submit = () => {
    if (canSend) onSend();
  };
  const onKeyDown = (event: KeyDownEvent) => {
    if (!isSendShortcut(event.nativeEvent)) return;
    event.preventDefault();
    submit();
  };

  return (
    <View style={[styles.footer, style]} testID="composer">
      <View style={styles.chips}>
        {skills.map((skill) => (
          <Chip
            key={skill}
            label={`/${skill}`}
            accessibilityLabel={`Run /${skill}`}
            disabled={controls.skillsDisabled || Boolean(pending.skill)}
            onPress={() => onRunSkill(skill)}
            testID={`composer-skill-${skill}`}
          />
        ))}
        <Chip
          label="Apply model now"
          disabled={controls.applyModel.disabled || Boolean(pending.applyModel)}
          onPress={onApplyModel}
          testID="composer-apply-model"
        />
        <View style={styles.spacer} />
        <Chip
          label="Steer now"
          checked={steerNow}
          disabled={!controls.live || controls.paused}
          onPress={() => onSteerNowChange(!steerNow)}
          testID="composer-steer-now"
        />
      </View>
      <View style={styles.inputRow}>
        {/* Capture: the text input stops key events from bubbling (react-native-web #612). */}
        <View style={styles.field} onKeyDownCapture={onKeyDown}>
          <TextField
            variant="multiline"
            rows={1}
            aria-label="Message the agent"
            placeholder={COMPOSER_PLACEHOLDER}
            value={text}
            onChangeText={onChangeText}
            maxLength={AGENT_MESSAGE_LIMIT}
            testID="composer-input"
          />
        </View>
        {controls.stop.visible ? (
          <Button label="Stop" icon="stop" variant="danger" onPress={() => onStop?.()} loading={pending.stop} testID="composer-stop" />
        ) : null}
        <Button
          label={controls.pause.label}
          icon={controls.pause.icon}
          iconOnly
          onPress={onPauseResume}
          disabled={controls.pause.disabled}
          loading={pending.pause}
          style={styles.square}
          testID="composer-pause"
        />
        <Button
          variant="primary"
          label="Send"
          onPress={submit}
          disabled={!canSend}
          loading={pending.send}
          style={styles.send}
          testID="composer-send"
        />
      </View>
      {error ? (
        <Text variant="meta" size="md" color={tone.danger.text} role="alert" testID="composer-error">
          {error}
        </Text>
      ) : controls.note ? (
        <Text variant="meta" size="md" color={controls.paused ? tone.attention.text : undefined} testID="composer-note">
          {controls.note}
        </Text>
      ) : null}
    </View>
  );
}


interface ChipProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** A toggle chip ("Steer now"): announced as a checkbox with its state. */
  checked?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/** Artboard 3's footer chips: mono, 34 px, a 1 px line border; a checked toggle is violet-tinted. */
function Chip({ label, onPress, disabled = false, checked, accessibilityLabel, testID }: ChipProps) {
  const toggle = checked !== undefined;
  return (
    <Pressable
      role={toggle ? 'checkbox' : 'button'}
      aria-checked={toggle ? checked : undefined}
      aria-label={accessibilityLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      // The target is 44 px tall (AL-033); the chip drawn inside it is 34 px, as on the artboard.
      style={styles.chipTarget}
      testID={testID}
    >
      {({ pressed }) => (
        <View style={[styles.chip, checked && styles.chipOn, disabled && styles.chipDisabled, pressed && styles.chipPressed]}>
          <Text variant="mono" size="sm" color={checked ? tone.claude.text : color.ink}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** Read off artboard 3: a pale band under the stream, chips 8 px apart, a one-line box beside a square pause and Send. */
const styles = StyleSheet.create({
  footer: {
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.line,
    backgroundColor: color.bg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  spacer: {
    flexGrow: 1,
  },
  chipTarget: {
    minHeight: minTarget,
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  chipOn: {
    borderColor: tone.claude.band,
    backgroundColor: tone.claude.band,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipPressed: {
    opacity: 0.8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  field: {
    flex: 1,
    minWidth: 0,
  },
  square: {
    width: 48,
  },
  send: {
    minWidth: 76,
  },
});
