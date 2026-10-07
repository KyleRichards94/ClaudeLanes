import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, tone } from '@agent-lanes/tokens';
import { Text } from './Text';

export interface IdChipProps {
  /** Azure DevOps work item id, e.g. 71273 or "71273" (a leading "#" is ignored). Shown as `#71273`. */
  id: number | string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The work item id in mono on the Azure DevOps tint, as on every card (artboards 1, 3 and 6). */
export function IdChip({ id, style, testID }: IdChipProps) {
  const digits = String(id).trim().replace(/^#/, '');

  return (
    <View testID={testID} style={[styles.chip, style]}>
      <Text variant="mono" size="xs" color={tone.ado.text} numberOfLines={1}>
        {`#${digits}`}
      </Text>
    </View>
  );
}

/** 19 px tall (1 + 17 + 1) with 6 px sides, read off the card headers on artboards 1 and 6. */
const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.chip,
    backgroundColor: tone.ado.band,
  },
});
