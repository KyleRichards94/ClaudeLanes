import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

export interface HoverHintProps {
  /** Shown when the pointer rests on `children` (the system tooltip on web). */
  hint: string | null;
  /** How the wrapper sits in a flex row: the child fills it. */
  style?: Pick<ViewStyle, 'flexGrow' | 'flexShrink' | 'flexBasis' | 'minWidth'>;
  children: ReactNode;
}

/** Native builds have no pointer to hover with; the hint is web-only (HoverHint.web.tsx). */
export function HoverHint({ style, children }: HoverHintProps) {
  return <View style={style}>{children}</View>;
}
