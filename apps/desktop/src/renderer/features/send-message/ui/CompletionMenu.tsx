import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { color, radius, shadow, space } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import type { CommandItem } from '../model/completion';

export type CompletionEntry = { readonly kind: 'command'; readonly item: CommandItem } | { readonly kind: 'file'; readonly path: string };

export interface CompletionMenuProps {
  entries: readonly CompletionEntry[];
  /** The highlighted entry, moved with the arrow keys. */
  active: number;
  onPick(index: number): void;
  onHover(index: number): void;
  /** What the menu says when nothing matches. */
  empty: string;
  testID?: string;
}

/**
 * The composer's completion list (AL-259): the repo's skills and the session's commands after `/`,
 * worktree files after `@`. Sits over the composer; Up / Down move, Enter or Tab pick, Esc closes.
 */
export function CompletionMenu({ entries, active, onPick, onHover, empty, testID = 'composer-completions' }: CompletionMenuProps) {
  return (
    <View role="menu" aria-label="Completions" style={styles.menu} testID={testID}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="always">
        {entries.length === 0 ? (
          <Text variant="meta" size="sm" style={styles.empty}>
            {empty}
          </Text>
        ) : (
          entries.map((entry, index) => (
            <Pressable
              key={entry.kind === 'command' ? `c:${entry.item.name}` : `f:${entry.path}`}
              role="menuitem"
              aria-selected={index === active}
              onPress={() => onPick(index)}
              onHoverIn={() => onHover(index)}
              style={[styles.item, index === active && styles.itemActive]}
              testID={`${testID}-item`}
            >
              <Icon name={entry.kind === 'command' ? 'compact' : 'file'} size={14} color={color.muted} />
              {entry.kind === 'command' ? (
                <View style={styles.itemText}>
                  <Text variant="mono" size="sm" numberOfLines={1}>
                    {`/${entry.item.name}${entry.item.argumentHint ? ` ${entry.item.argumentHint}` : ''}`}
                  </Text>
                  {entry.item.description ? (
                    <Text variant="meta" size="xs" numberOfLines={1}>
                      {entry.item.description}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Text variant="mono" size="sm" numberOfLines={1} style={styles.itemText}>
                  {entry.path}
                </Text>
              )}
              {entry.kind === 'command' ? (
                <Text variant="meta" size="xs" color={color.muted}>
                  {entry.item.source === 'skill' ? 'skill' : 'command'}
                </Text>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: '100%',
    marginBottom: space.xs,
    maxHeight: 280,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.lifted,
    overflow: 'hidden',
    zIndex: 20,
  },
  scroll: {
    maxHeight: 280,
  },
  empty: {
    padding: space.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  itemActive: {
    backgroundColor: color.bg,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
});
