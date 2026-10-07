import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TicketDesignSpec } from '@agent-lanes/contracts';
import { color, space } from '@agent-lanes/tokens';
import { GlassPanel, Pill, Text } from '@agent-lanes/ui';
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

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Sent / Used · 14:01 / Superseded, from the record's spec list (AL-199 adds viewing and re-shipping). */
export function specStatus(spec: TicketDesignSpec, latestVersion: number): { label: string; tone: 'ok' | 'claude' | 'neutral' } {
  if (spec.version < latestVersion) return { label: 'Superseded', tone: 'neutral' };
  if (spec.usedAt !== null) return { label: `Used · ${clock(spec.usedAt)}`, tone: 'ok' };
  return { label: 'Sent', tone: 'claude' };
}

/** "Attached to this ticket": shipped design specs, newest first, and the design-system file. */
export function AttachedSection({ specs }: { specs: readonly TicketDesignSpec[] }) {
  const latest = specs.at(-1)?.version ?? 0;
  return (
    <SideSection title="Attached to this ticket" testID="design-attached">
      {[...specs].reverse().map((spec) => {
        const status = specStatus(spec, latest);
        return (
          <View key={spec.version} style={styles.row}>
            <Text variant="body" numberOfLines={1} style={styles.rowText}>
              {`Design v${spec.version} · ${spec.artboardCount} artboard${spec.artboardCount === 1 ? '' : 's'}`}
            </Text>
            <Pill label={status.label} tone={status.tone} />
          </View>
        );
      })}
      <View style={styles.row}>
        <Text variant="body" numberOfLines={1} style={styles.rowText}>
          agent-lanes-tokens.css
        </Text>
        <Pill label="Design system" tone="ado" />
      </View>
    </SideSection>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  rowText: {
    flex: 1,
  },
});
