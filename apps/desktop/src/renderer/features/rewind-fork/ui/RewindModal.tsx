import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { toast } from '@/shared/model';
import { useRewind } from '../api/rewind';

export interface RewindModalProps {
  ticketId: string;
  /** The user message to rewind to; null closes the modal. */
  messageId: string | null;
  /** "You · 14:02", for the title. */
  caption: string;
  onClose(): void;
  testID?: string;
}

/**
 * Rewind to here (AL-265): opens on a dry run that lists the files the SDK would restore, then
 * restores them on confirm. A rewind the SDK or the pushed-commit rule refuses says why.
 */
export function RewindModal({ ticketId, messageId, caption, onClose, testID = 'rewind' }: RewindModalProps) {
  return messageId ? <RewindDialog ticketId={ticketId} messageId={messageId} caption={caption} onClose={onClose} testID={testID} /> : null;
}

function RewindDialog({ ticketId, messageId, caption, onClose, testID }: Omit<RewindModalProps, 'messageId'> & { messageId: string; testID: string }) {
  const preview = useRewind(ticketId);
  const rewind = useRewind(ticketId);
  const { mutate: dryRun } = preview;
  useEffect(() => {
    dryRun({ messageId, dryRun: true });
  }, [dryRun, messageId]);

  const result = preview.data;
  const blocked = preview.isPending || preview.isError || result?.canRewind === false || rewind.isPending;
  const confirm = () =>
    rewind.mutate(
      { messageId, dryRun: false },
      {
        onSuccess: (done) => {
          toast({ id: `rewind:${ticketId}`, tone: done.canRewind ? 'success' : 'error', title: done.canRewind ? `Rewound ${done.filesChanged.length} ${done.filesChanged.length === 1 ? 'file' : 'files'}` : "Couldn't rewind", body: done.canRewind ? `Back to ${caption}.` : (done.error ?? undefined) });
          if (done.canRewind) onClose();
        },
      },
    );
  const failure = preview.error ?? rewind.error;

  return (
    <Modal
      visible
      title={`Rewind to ${caption}?`}
      subtitle="Tracked files in the worktree go back to how they were at that message; the output stays."
      icon="rewind"
      width={560}
      onClose={rewind.isPending ? () => undefined : onClose}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label="Cancel" onPress={onClose} disabled={rewind.isPending} />
          <Button variant="danger" label={result ? `Rewind ${result.filesChanged.length} ${result.filesChanged.length === 1 ? 'file' : 'files'}` : 'Rewind'} onPress={confirm} disabled={blocked} loading={rewind.isPending} testID={`${testID}-confirm`} />
        </View>
      }
      testID={`${testID}-modal`}
    >
      <View style={styles.body}>
        {preview.isPending ? (
          <Text variant="meta">Checking what would change…</Text>
        ) : failure ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID={`${testID}-error`}>
            {failure.message}
          </Text>
        ) : result && !result.canRewind ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID={`${testID}-error`}>
            {result.error ?? 'The session cannot rewind to that message.'}
          </Text>
        ) : result ? (
          <>
            <Text variant="body" size="sm" testID={`${testID}-summary`}>
              {result.filesChanged.length === 0 ? 'Nothing has changed since that message.' : `${result.filesChanged.length} ${result.filesChanged.length === 1 ? 'file goes' : 'files go'} back (+${result.insertions} −${result.deletions} lines undone).`}
            </Text>
            <ScrollView style={styles.files}>
              {result.filesChanged.map((file) => (
                <Text key={file} variant="mono" size="xs" color={color.muted} selectable>
                  {file}
                </Text>
              ))}
            </ScrollView>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.sm },
  files: { maxHeight: 240 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
