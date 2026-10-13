import type { HoverHintProps } from './HoverHint';

/**
 * Web (Electron): the hint is the wrapper's `title`, so resting the pointer on the child shows it in the system
 * tooltip. React Native's View has no `title`, hence this web-only file. The wrapper is a flex box so a tile or a
 * turn button keeps its place and width in a flex row.
 */
export function HoverHint({ hint, style, children }: HoverHintProps) {
  return (
    <div
      title={hint ?? undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: style?.minWidth as number | undefined,
        flexGrow: style?.flexGrow,
        flexShrink: style?.flexShrink ?? 1,
        flexBasis: style?.flexBasis as number | string | undefined,
      }}
    >
      {children}
    </div>
  );
}
