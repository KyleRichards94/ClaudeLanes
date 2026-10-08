import type { ReactNode } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

export interface StickyTopProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

/**
 * Keeps its children pinned to the top of the board's scroll area while the page scrolls (the board
 * header, and under it the collapsed agent board). React Native has no sticky positioning, so a native
 * build scrolls them away; `StickyTop.web.tsx` pins them on web.
 */
export function StickyTop({ children, style, onLayout, testID }: StickyTopProps) {
  return (
    <View style={style} onLayout={onLayout} testID={testID}>
      {children}
    </View>
  );
}
