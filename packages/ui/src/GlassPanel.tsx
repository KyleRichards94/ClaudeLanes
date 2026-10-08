import type { ComponentRef, ReactNode, Ref } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { glass, radius, type GlassLevel } from '@agent-lanes/tokens';

const blurPx: Record<GlassLevel, number> = {
  sm: glass.blurSm,
  md: glass.blurMd,
  xl: glass.blurXl,
};

export interface GlassPanelProps {
  /** sm: chips and toolbar buttons · md: panels, header, live dock · xl: modals and sheets. */
  level?: GlassLevel;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
  /** The panel's host view (a drop target measures it, AL-235). */
  ref?: Ref<ComponentRef<typeof View>>;
}

/**
 * Light liquid-glass surface. react-native-web passes `backdropFilter` through to CSS
 * in Electron's Chromium (design §11); a native build would swap this for expo-blur.
 */
export function GlassPanel({ level = 'md', style, children, testID, ref }: GlassPanelProps) {
  const blur = blurPx[level];
  // backdropFilter and boxShadow strings are web-only style keys, so they sit outside the RN style types.
  const webGlass = {
    backdropFilter: `blur(${blur}px) saturate(160%)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(160%)`,
    boxShadow: glass.highlight,
  } as unknown as ViewStyle;

  return (
    <View ref={ref} testID={testID} style={[styles.base, level === 'xl' && styles.modal, webGlass, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: glass.fillMin,
    borderColor: glass.border,
    borderWidth: 1,
    borderRadius: radius.panel,
  },
  modal: {
    backgroundColor: glass.fillMax,
    borderRadius: radius.modal,
  },
});
