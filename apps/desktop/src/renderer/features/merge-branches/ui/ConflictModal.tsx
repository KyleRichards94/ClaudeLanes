import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { useHandConflictToLead, useOpenConflictFiles, type AgentTicket } from '@/entities/agent-ticket';
import { useTicketDiff } from '@/shared/api';
import { showErrorRecovery, toast } from '@/shared/model';
import { mergeErrorInfo, type MergeErrorInfo } from '../model/conflict';
import { FileList } from './FileList';

export interface ConflictModalProps {
  visible: boolean;
  ticket: Pick<AgentTicket, 'id' | 'branch'>;
  /** What the failed merge said; null when the panel only knows the worktree is conflicted (after a reload). */
  conflict: MergeErrorInfo | null;
  onClose(): void;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The conflict view (AL-174, design §9 step 4): Merge sub-branches stopped at the first conflict and
 * left it in the ticket worktree. Lists the conflicted files, then "Hand to lead agent" (the files go
 * to the agent as its next turn) or "Open in editor" (the user resolves them). Without the merge's
 * own error (the page was reloaded) the files come from the worktree's unmerged paths.
 */
export function ConflictModal({ visible, ticket, conflict, onClose }: ConflictModalProps) {
  const known = conflict !== null && conflict.files.length > 0;
  const diff = useTicketDiff(ticket.id, { kind: 'base' }, { enabled: visible && !known });
  const files = known ? conflict.files : (diff.data?.files.filter((file) => file.status === 'unmerged').map((file) => file.path) ?? []);
  const hand = useHandConflictToLead();
  const open = useOpenConflictFiles();

  const onHand = () =>
    hand.mutate(
      { ticketId: ticket.id },
      {
        onSuccess: (result) => {
          toast({
            id: `conflict:${ticket.id}`,
            tone: 'success',
            title: 'Handed to the lead agent',
            body: result.held
              ? `The agent is paused; it gets ${plural(result.files.length, 'conflicted file')} when you resume it.`
              : `The agent is resolving ${plural(result.files.length, 'conflicted file')}.`,
          });
          onClose();
        },
        onError: (error) => showErrorRecovery(mergeErrorInfo(error), { ticketId: ticket.id }),
      },
    );

  const onOpen = () =>
    open.mutate(
      { ticketId: ticket.id },
      {
        onSuccess: (result) => {
          if (result.fileCount > result.opened.length) {
            toast({
              id: `conflict:${ticket.id}`,
              tone: 'info',
              title: `Opened ${result.opened.length} of ${result.fileCount} files`,
              body: 'Open the rest from your editor.',
            });
          }
        },
        onError: (error) => showErrorRecovery(mergeErrorInfo(error), { ticketId: ticket.id }),
      },
    );

  const from = conflict?.branch;
  return (
    <Modal
      visible={visible}
      title="Merge stopped on a conflict"
      subtitle={from ? `${from} → ${ticket.branch}` : `In ${ticket.branch}'s worktree`}
      icon="merge"
      width={560}
      onClose={onClose}
      testID="merge-conflict-modal"
      footer={
        <>
          <Button label="Open in editor" icon="external-link" loading={open.isPending} onPress={onOpen} testID="conflict-open-editor" />
          <Button label="Hand to lead agent" variant="primary" loading={hand.isPending} onPress={onHand} testID="conflict-hand-to-lead" />
        </>
      }
    >
      <View style={styles.body}>
        {conflict && conflict.merged.length > 0 ? (
          <Text variant="body" testID="conflict-merged">
            {`Merged first: ${conflict.merged.join(', ')}.`}
          </Text>
        ) : null}
        <Text variant="body">
          {conflict?.reason === 'merge-in-progress'
            ? 'An earlier merge is still waiting on these files. Nothing else was merged.'
            : 'The merge is left in progress in the ticket worktree. Nothing after this branch was merged.'}
        </Text>
        {files.length > 0 ? (
          <>
            <Text variant="title">{`${plural(files.length, 'conflicted file')}`}</Text>
            <FileList files={files} testID="conflict-files" />
          </>
        ) : !known && diff.isPending ? (
          <Text variant="meta">Finding the conflicted files…</Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.md,
  },
});
