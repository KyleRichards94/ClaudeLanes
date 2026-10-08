import { StyleSheet, View } from 'react-native';
import { Text } from '@agent-lanes/ui';
import { useDragAnnouncement } from '../model/drag-store';

/**
 * The polite live region for drops made from the "Send to lane" menu ("Sent #71318 to Planning: plan
 * it"); dnd-kit announces pointer and keyboard drags in its own region. Off screen, still read.
 */
export function AnnouncementRegion() {
  const { text, seq } = useDragAnnouncement();
  return (
    <View role="status" aria-live="polite" aria-atomic style={styles.hidden} testID="drag-to-lane-announcement">
      {text ? <Text key={seq}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
    pointerEvents: 'none',
  },
});
