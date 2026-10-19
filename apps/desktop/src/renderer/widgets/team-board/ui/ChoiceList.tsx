import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';

export interface Choice {
  value: string;
  label: string;
}

/** A short radio list: the open card's person and its status (a board column). */
export function ChoiceList({ label, options, value, onChange, disabled = false, testID }: { label: string; options: readonly Choice[]; value: string | null; onChange(value: string): void; disabled?: boolean; testID?: string }) {
  return (
    <View style={styles.block}>
      <Text variant="title" size="sm">
        {label}
      </Text>
      <View role="radiogroup" aria-label={label} style={styles.list} testID={testID}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={[styles.row, selected && styles.rowSelected]}
              testID={testID ? `${testID}-${option.value}` : undefined}
            >
              <View style={styles.mark}>{selected ? <Icon name="check" size={14} color={color.claude} /> : null}</View>
              <Text variant={selected ? 'title' : 'body'} size="md" numberOfLines={1} style={styles.label}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space.xs,
    flex: 1,
    minWidth: 200,
  },
  list: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowSelected: {
    borderColor: color.claude,
    backgroundColor: color.bg,
  },
  mark: {
    width: 16,
    alignItems: 'center',
  },
  label: {
    flex: 1,
  },
});
