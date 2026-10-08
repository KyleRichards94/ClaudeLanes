import { StyleSheet, View, type ViewStyle } from 'react-native';
import { STICKY_TOP_OFFSET } from '../model/sticky';
import type { StickyTopProps } from './StickyTop';

/**
 * Web (Electron): `position: sticky` inside the board's ScrollView, so the header stays at the top
 * while the lanes and the team board scroll under its glass. It stacks above the cards (whose hover
 * lift makes their own stacking contexts). React Native's style types have no `sticky`, hence the cast.
 */
export function StickyTop({ children, style, onLayout, testID }: StickyTopProps) {
  return (
    <View style={[styles.sticky, style]} onLayout={onLayout} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sticky: {
    position: 'sticky',
    top: STICKY_TOP_OFFSET,
    zIndex: 20,
  } as unknown as ViewStyle,
});
