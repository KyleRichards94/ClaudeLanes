import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { Text, Toast, toastWidth, type ToastAction } from '@agent-lanes/ui';
import {
  INFO_TOAST_DURATION_MS,
  autoDismisses,
  dismissToast,
  useToasts,
  type ToastActionInput,
  type ToastEntry,
} from '@/shared/model';
import { useRouter } from '@/shared/routing';
import { createRecoveryEnvironment } from './recovery-environment';
import { runToastIntent, type ToastIntentContext } from './toast-intents';

/** How many toasts show at once. Later ones wait, in order, and appear as earlier ones close. */
export const MAX_VISIBLE_TOASTS = 4;

/** Clears the board's live dock (artboard 1: 50 px tall, 20 px above the window edge) with a 16 px gap. */
const STACK_BOTTOM = 20 + 50 + space.lg;

/**
 * Shows the app's toasts (AL-030), raised with `toast()` from `@/shared/model` or by the main process
 * through the `toast` event: a column in the bottom-right corner, oldest at the top, newest at the
 * bottom. Info toasts close after 5 s, paused while the pointer is over them or focus is inside;
 * every other tone stays until the user presses one of its buttons. A button runs its action
 * (a callback, or the intent a main-process toast named) and then closes the toast.
 */
export function ToastHost() {
  const toasts = useToasts();
  const router = useRouter();
  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);
  const waiting = toasts.length - visible.length;

  function run(entry: ToastEntry, action: ToastActionInput) {
    const context: ToastIntentContext = { ...createRecoveryEnvironment(router.navigate), navigate: router.navigate };
    try {
      if ('onPress' in action) action.onPress();
      else runToastIntent(action.intent, context);
    } catch (error) {
      // The toast stays, so the user can try again or dismiss it.
      console.error(`The "${action.label}" action on a toast failed`, error);
      return;
    }
    dismissToast(entry.id);
  }

  return (
    // A landmark, so a screen reader user can jump to a toast and act on it. Each toast is its own
    // live region (see Toast), so the stack itself is not one.
    <View role="region" aria-label="Notifications" style={styles.stack} testID="toast-host">
      {visible.map((entry) => (
        // A toast raised again under the same id remounts, so its timer starts over and it is read again.
        <ToastItem key={`${entry.id}#${entry.revision}`} entry={entry} onAction={(action) => run(entry, action)} />
      ))}
      {waiting > 0 ? (
        <Text variant="meta" style={styles.waiting} testID="toast-host-waiting">
          {waiting === 1 ? '1 more notice' : `${waiting} more notices`}
        </Text>
      ) : null}
    </View>
  );
}

interface ToastItemProps {
  entry: ToastEntry;
  onAction: (action: ToastActionInput) => void;
}

function ToastItem({ entry, onAction }: ToastItemProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(INFO_TOAST_DURATION_MS);
  const timed = autoDismisses(entry);
  const paused = hovered || focused;

  // Counts down only while the toast isn't being read or used; a pause keeps the time left.
  useEffect(() => {
    if (!timed || paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismissToast(entry.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [timed, paused, entry.id]);

  const actions: ToastAction[] = entry.actions.map((action) => ({ label: action.label, onPress: () => onAction(action) }));
  // A plain info notice closes itself; anything with a button or that waits for the user gets Dismiss.
  const dismissible = !timed || actions.length > 0;

  return (
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={styles.item}
      testID={`toast-${entry.id}`}
    >
      <Toast
        tone={entry.tone}
        title={entry.title}
        body={entry.body}
        actions={actions}
        onDismiss={dismissible ? () => dismissToast(entry.id) : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    right: space.xl,
    bottom: STACK_BOTTOM,
    width: toastWidth,
    maxWidth: '90%',
    gap: space.sm + 2,
    alignItems: 'stretch',
    // Clicks between and around the toasts reach the page underneath.
    pointerEvents: 'box-none',
    zIndex: 10,
  },
  item: {
    pointerEvents: 'auto',
  },
  waiting: {
    alignSelf: 'flex-end',
    paddingHorizontal: space.sm,
  },
});
