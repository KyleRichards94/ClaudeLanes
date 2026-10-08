import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { GlassPanel, Text } from '@agent-lanes/ui';
import { ErrorBoundary } from '@/shared/ui';

/** One section of the design tab's side panel (artboard 4), with its own error boundary. */
export function SideSection({ title, children, testID }: { title: string; children?: ReactNode; testID: string }) {
  return (
    <GlassPanel style={styles.section} testID={testID}>
      <ErrorBoundary name={`design:${testID}`} label={`${title}`}>
        <Text variant="title" role="heading" aria-level={2} style={styles.heading}>
          {title}
        </Text>
        {children}
      </ErrorBoundary>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: space.lg,
    gap: space.sm,
  },
  heading: {
    marginBottom: space.xs,
  },
});
