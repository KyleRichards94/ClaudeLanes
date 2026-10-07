import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';

export interface ConnectionFormProps {
  /** "Add an organisation", "Replace the token for CompanionSystems". */
  title: string;
  /** On the right of the title, e.g. a "Cancel replace" button. */
  aside?: ReactNode;
  children: ReactNode;
  testID?: string;
}

/** The draft row (artboard 5's "Add an organisation"): a white card with the violet outline and glow. */
export function ConnectionForm({ title, aside, children, testID }: ConnectionFormProps) {
  return (
    <View style={styles.form} role="group" aria-label={title} testID={testID}>
      <View style={styles.header}>
        <Text variant="title" role="heading" aria-level={3} style={styles.title}>
          {title}
        </Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

/** Read off artboard 5: 16 px padding, 14 px between rows, violet outline with a soft violet glow. */
const styles = StyleSheet.create({
  form: {
    gap: 14,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: tone.claude.border,
    backgroundColor: color.surface,
    boxShadow: `0 0 0 3px ${tone.claude.band}, ${shadow.card}`,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 24,
  },
  title: {
    flex: 1,
  },
});
