import { StyleSheet, View } from 'react-native';
import { color, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import type { DraftTest } from '../model/draft-test';

interface TestOutcomeProps {
  test: DraftTest;
  /** The words for a passed test, e.g. "Connection works · signed in as Kyle Richards". */
  passedText: string;
  testID?: string;
}

/**
 * The line under a draft row saying how Test connection went: a check and who it signed in as, or
 * the alert icon and the reason in red. A polite live region, so the result is read out when it lands.
 */
export function TestOutcome({ test, passedText, testID }: TestOutcomeProps) {
  const passed = test.state === 'passed';
  const failed = test.state === 'failed';

  return (
    <View role="status" aria-live="polite" testID={testID}>
      {passed || failed ? (
        <View style={styles.row}>
          <Icon name={passed ? 'check' : 'alert'} size={14} color={passed ? color.ok : color.danger} />
          <Text variant="meta" size="md" color={passed ? tone.ok.text : tone.danger.text} selectable style={styles.text}>
            {passed ? passedText : (test.message ?? 'The test failed.')}
          </Text>
        </View>
      ) : test.state === 'testing' ? (
        <Text variant="meta" size="md">
          Testing the connection…
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
  },
  text: {
    flexShrink: 1,
  },
});
