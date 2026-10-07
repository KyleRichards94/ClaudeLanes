import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Pill, Text } from '@agent-lanes/ui';
import type { ConnectionStatusView } from '../model/status';

export interface ConnectionRowProps {
  /** The organisation, `Claude` or the MCP server's name. */
  name: string;
  status: ConnectionStatusView;
  /** The detail line: "dev.azure.com/CompanionSystems · signed in as Kyle Richards · token ••••••••7Fq2". */
  details: string;
  /** What went wrong, shown in red under the details (a failed test, a server's error output). */
  problem?: string | null;
  /** Extra lines under the details, e.g. the scope chips or an MCP server's tools. */
  children?: ReactNode;
  /** Buttons on the right: Replace, Remove. */
  actions?: ReactNode;
  /** Outlines the row the user was sent to (a Reconnect). */
  highlighted?: boolean;
  testID?: string;
}

/** A saved connection (artboard 5): name and status pill, the detail line, and its actions on the right. */
export function ConnectionRow({ name, status, details, problem, children, actions, highlighted = false, testID }: ConnectionRowProps) {
  return (
    <View style={[styles.row, highlighted && styles.highlighted]} testID={testID} role="group" aria-label={`${name}, ${status.label}`}>
      <View style={styles.text}>
        <View style={styles.title}>
          <Text variant="title" numberOfLines={1}>
            {name}
          </Text>
          <Pill tone={status.tone} label={status.label} testID={testID ? `${testID}-status` : undefined} />
        </View>
        <Text variant="meta" size="md" selectable testID={testID ? `${testID}-details` : undefined}>
          {details}
        </Text>
        {problem ? (
          <View style={styles.problem}>
            <Icon name="alert" size={14} color={color.danger} />
            <Text variant="meta" color={tone.danger.text} selectable style={styles.problemText} testID={testID ? `${testID}-problem` : undefined}>
              {problem}
            </Text>
          </View>
        ) : null}
        {children}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/** Read off artboard 5: 16 px sides, 12 px above and below the 44 px actions, a 1 px line border. */
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  highlighted: {
    borderColor: tone.claude.border,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  problem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    paddingTop: 2,
  },
  problemText: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
