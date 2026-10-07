import type { StyleProp, ViewStyle } from 'react-native';
import { Pill, type PillSize, type PillTone } from './Pill';

/** An agent's state, as the "Status badges" block on artboard 6 shows it. */
export type BadgeStatus = 'running' | 'done' | 'queued' | 'needs-you' | 'switching';

/** Every status, in the artboard's order, for the component gallery and tests. */
export const badgeStatuses: readonly BadgeStatus[] = ['running', 'done', 'queued', 'needs-you', 'switching'];

interface StatusSpec {
  /** The fixed word the badge says. */
  label: string;
  tone: PillTone;
  dot: boolean;
}

/**
 * Fixed words and tints from the "Status badges" block on artboard 6. "Switching · next turn" has
 * no dot: the model change applies from the agent's next turn (R7).
 */
const statusSpecs: Record<BadgeStatus, StatusSpec> = {
  running: { label: 'Running', tone: 'claude', dot: true },
  done: { label: 'Done', tone: 'ok', dot: true },
  queued: { label: 'Queued', tone: 'neutral', dot: true },
  'needs-you': { label: 'Needs you', tone: 'attention', dot: true },
  switching: { label: 'Switching · next turn', tone: 'ado', dot: false },
};

/** The fixed word a status badge shows, e.g. "Needs you". */
export function statusLabel(status: BadgeStatus): string {
  return statusSpecs[status].label;
}

export interface StatusBadgeProps {
  status: BadgeStatus;
  /** Defaults to `sm`, the size on artboard 6. */
  size?: PillSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A Pill with a fixed word per agent state, so the state never shows by colour alone. */
export function StatusBadge({ status, size, style, testID }: StatusBadgeProps) {
  const { label, tone, dot } = statusSpecs[status];
  return <Pill label={label} tone={tone} dot={dot} size={size} style={style} testID={testID} />;
}
