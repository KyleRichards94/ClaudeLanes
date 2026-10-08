import type { ReactNode } from 'react';

export interface HoverHintProps {
  /** Shown when the pointer rests on `children` (the browser's own tooltip on web). */
  hint: string | null;
  children: ReactNode;
}

/** Native builds have no pointer to hover with; the hint is web-only (HoverHint.web.tsx). */
export function HoverHint({ children }: HoverHintProps) {
  return <>{children}</>;
}
