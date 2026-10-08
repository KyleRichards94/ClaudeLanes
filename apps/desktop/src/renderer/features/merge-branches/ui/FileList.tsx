import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';

/** Most files listed before "and N more". */
export const FILE_LIST_LIMIT = 12;

/** Conflicted or uncommitted files, one per row in mono (AL-174). */
export function FileList({ files, testID }: { files: readonly string[]; testID?: string }) {
  const shown = files.slice(0, FILE_LIST_LIMIT);
  const more = files.length - shown.length;
  return (
    <View style={styles.list} role="list" testID={testID}>
      {shown.map((file) => (
        <View key={file} role="listitem" style={styles.row}>
          <Text variant="mono" size="sm" selectable numberOfLines={1}>
            {file}
          </Text>
        </View>
      ))}
      {more > 0 ? (
        <Text variant="meta" style={styles.more}>
          {`and ${more} more`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.line,
    marginTop: -1,
  },
  more: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
});
