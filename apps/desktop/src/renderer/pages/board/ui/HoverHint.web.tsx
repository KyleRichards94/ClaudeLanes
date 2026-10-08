import type { HoverHintProps } from './HoverHint';

/**
 * Web (Electron): the hint is the wrapper's `title`, so resting the pointer on the child shows it in
 * the system tooltip. React Native's View has no `title`, hence this web-only file.
 */
export function HoverHint({ hint, children }: HoverHintProps) {
  return (
    <div title={hint ?? undefined} style={{ display: 'flex' }}>
      {children}
    </div>
  );
}
