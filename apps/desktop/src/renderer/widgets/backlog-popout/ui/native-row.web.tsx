import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { StyleSheet, View } from 'react-native';
import { NATIVE_BACKLOG_DRAG_TYPE, dragMembers, encodeNativeBacklogDrag } from '@/features/drag-to-lane';
import type { NativeDragRowProps } from './native-row';

/**
 * Web (Electron): a row of the popped-out Backlog window (TB§5). dnd-kit only works inside one
 * window, so the row is a native HTML5 drag source carrying its rows (or the selected group) as
 * `NATIVE_BACKLOG_DRAG_TYPE`, which the main window's lanes take.
 */
export function NativeDragRow({ drag, label, style, testID, accessory, onClick, children }: NativeDragRowProps) {
  if (!drag) {
    return (
      <View role="listitem" aria-label={label} style={style} testID={testID}>
        {children}
        {accessory}
      </View>
    );
  }
  const onDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData(NATIVE_BACKLOG_DRAG_TYPE, encodeNativeBacklogDrag(drag));
    event.dataTransfer.setData(
      'text/plain',
      dragMembers(drag)
        .map((member) => `${member.label} ${member.title}`)
        .join('\n'),
    );
    event.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <View role="listitem" aria-label={label} style={styles.item}>
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onClick ? (event: ReactMouseEvent) => onClick({ shiftKey: event.shiftKey }) : undefined}
        data-testid={testID}
        style={{ cursor: 'grab' }}
      >
        <View style={style}>{children}</View>
      </div>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'column',
  },
});
