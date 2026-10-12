import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { Button } from '@agent-lanes/ui';

export interface UserMessageActionsProps {
  messageId: string;
  onRewind(messageId: string): void;
  onFork(messageId: string): void;
  testID?: string;
}

/** The two actions on one of the user's messages (AL-265): Rewind to here and Fork from here. */
export function UserMessageActions({ messageId, onRewind, onFork, testID = 'message-actions' }: UserMessageActionsProps) {
  return (
    <View style={styles.row} testID={testID}>
      <Button size="sm" variant="secondary" icon="rewind" label="Rewind to here" onPress={() => onRewind(messageId)} testID={`${testID}-rewind`} />
      <Button size="sm" variant="secondary" icon="fork" label="Fork from here" onPress={() => onFork(messageId)} testID={`${testID}-fork`} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.xs, marginTop: space.xs },
});
