import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';

export interface RadioListOption<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

/** A vertical radio group for a handful of choices (a work item's states, the lanes), one row each. */
export function RadioList<T extends string>({ label, options, value, onChange, disabled = false, testID }: { label: string; options: readonly RadioListOption<T>[]; value: T | null; onChange(value: T): void; disabled?: boolean; testID?: string }) {
  return (
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
            <View style={styles.text}>
              <Text variant={selected ? 'title' : 'body'} size="md">
                {option.label}
              </Text>
              {option.detail ? (
                <Text variant="meta" size="xs">
                  {option.detail}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    paddingHorizontal: space.md,
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
  text: {
    flex: 1,
  },
});
