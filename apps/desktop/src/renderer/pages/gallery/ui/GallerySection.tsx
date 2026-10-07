import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, space } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';

interface GallerySheetProps {
  /** Small mono or meta line above the title, as the artboards have ("Component sheet"). */
  kicker: string;
  title: string;
  /** Text on the right of the title row (the glass recipe credit on the tokens sheet). */
  aside?: string;
  children: ReactNode;
  testID?: string;
}

/** One artboard-sized sheet: kicker, display title, then its blocks (artboards 6 and 7). */
export function GallerySheet({ kicker, title, aside, children, testID }: GallerySheetProps) {
  return (
    <View style={styles.sheet} testID={testID}>
      <View style={styles.sheetHeader}>
        <View style={styles.sheetTitle}>
          <Text variant="meta" size="sm">
            {kicker}
          </Text>
          <Text variant="display" role="heading" aria-level={2}>
            {title}
          </Text>
        </View>
        {aside ? (
          <Text variant="meta" style={styles.aside}>
            {aside}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

interface GalleryBlockProps {
  /** The block's heading, e.g. "Colour" or "Running". */
  title: string;
  /** `rule` draws the line under the heading, as the tokens sheet does; card states have none. */
  rule?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A labelled block inside a sheet. */
export function GalleryBlock({ title, rule = false, children, style, testID }: GalleryBlockProps) {
  return (
    <View style={[styles.block, style]} testID={testID}>
      <View style={[styles.blockHeader, rule && styles.rule]}>
        <Text variant={rule ? 'title' : 'meta'} size={rule ? 'md' : 'sm'} role="heading" aria-level={3}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** A wrapping row of samples. */
export function GalleryRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  sheet: {
    gap: space.xl,
    paddingVertical: space.xl,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.xl,
  },
  sheetTitle: {
    gap: space.xs,
  },
  aside: {
    maxWidth: 460,
  },
  block: {
    gap: space.md,
  },
  blockHeader: {
    paddingBottom: space.xs,
  },
  rule: {
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
  },
});
