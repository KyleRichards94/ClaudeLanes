import { Pressable, StyleSheet, View } from 'react-native';
import type { ReviewFinding } from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Card, Text } from '@agent-lanes/ui';

export interface InspectorNotesProps {
  /** Findings for the selected file. */
  findings: readonly ReviewFinding[];
  onOpenPrThread?(threadId: number): void;
}

const severityStyle = {
  info: { background: color.bg, text: color.ink },
  warn: { background: tone.attention.band, text: tone.attention.text },
  error: { background: tone.danger.wash, text: tone.danger.text },
} as const;

const severityWord = { info: 'Note', warn: 'Warning', error: 'Error' } as const;

/** The reviewer's findings for the selected file. */
export function InspectorNotes({ findings, onOpenPrThread }: InspectorNotesProps) {
  return (
    <Card style={styles.card} testID="city-notes">
      <Text variant="title" size="md" style={styles.title}>
        Inspector’s notes
      </Text>
      <Text variant="meta" size="xs" style={styles.sub}>
        reviewer · posts via /pr-comment-actioner
      </Text>
      {findings.length === 0 ? (
        <Text variant="meta">No notes yet.</Text>
      ) : (
        findings.map((finding) => {
          const look = severityStyle[finding.severity];
          return (
            <View key={finding.id} style={[styles.note, { backgroundColor: look.background }]} testID={`city-note-${finding.severity}`}>
              <Text variant="body" size="sm" color={look.text} style={styles.noteText}>
                <Text variant="body" size="sm" color={look.text} style={styles.bold}>
                  {finding.line ? `Line ${finding.line}: ` : `${severityWord[finding.severity]}: `}
                </Text>
                {finding.text}
              </Text>
              {finding.prThreadId ? (
                <Pressable role="link" aria-label={`Posted to PR, thread ${finding.prThreadId}`} onPress={() => onOpenPrThread?.(finding.prThreadId!)} style={styles.link}>
                  <Text variant="meta" size="xs" color={color.ado} style={styles.linkText}>
                    Posted to PR
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, gap: 6 },
  title: { fontWeight: '800' },
  sub: { marginBottom: 2 },
  note: { borderRadius: 12, padding: 10, gap: 4 },
  noteText: { lineHeight: 18 },
  bold: { fontWeight: '800' },
  link: { alignSelf: 'flex-start' },
  linkText: { fontWeight: '700', textDecorationLine: 'underline' },
});
