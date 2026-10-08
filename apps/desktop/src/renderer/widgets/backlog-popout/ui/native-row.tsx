import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { LaneDragData } from '@/features/drag-to-lane';

export interface NativeDragRowProps {
  /** The row's drag; null when it can't be dragged. */
  drag: LaneDragData | null;
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessory?: ReactNode;
  onClick?: (event: { shiftKey: boolean }) => void;
  children: ReactNode;
}

/** Native builds have no second window: a row in the popped-out Backlog is just a list item. */
export function NativeDragRow({ label, style, testID, accessory, children }: NativeDragRowProps) {
  return (
    <View role="listitem" aria-label={label} style={style} testID={testID}>
      {children}
      {accessory}
    </View>
  );
}
