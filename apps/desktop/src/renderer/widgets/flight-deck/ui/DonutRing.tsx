import { View } from 'react-native';
import { DONUT_SIZE, type DonutSegment } from '../model/donut';

export interface DonutRingProps {
  segments: readonly DonutSegment[];
  /** Pulsing segments hold still (`prefers-reduced-motion`). */
  reduced: boolean;
}

/** Native builds draw no ring (the renderer imports no SVG library); the legend and rows say the same. See DonutRing.web.tsx. */
export function DonutRing(_props: DonutRingProps) {
  return <View style={{ width: DONUT_SIZE, height: DONUT_SIZE }} aria-hidden />;
}
