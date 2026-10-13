import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { UnmergedWork } from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, Modal, Switch, Text } from '@agent-lanes/ui';
import { useAgentTicket, useArchiveTicket } from '@/entities/agent-ticket';
import { useStopSession } from '@/shared/api';
import { toast } from '@/shared/model';
import { unmergedOf } from '../model/unmerged';

export interface RemoveTicketModalProps {
  ticketId: string;
  visible: boolean;
  onClose(): void;
  /** The ticket is off the board: the page it was on goes back to the board. */
  onRemoved?(): void;
  testID?: string;
}

/**
 * Remove a ticket from the agent board (Kyle, 2026-10-09; design §9 step 6's Archive): ends its
 * session, removes its worktrees and moves its record to the archive list. Unmerged commits or
 * uncommitted changes stop the first attempt; the modal then names them and asks once more.
 */
export function RemoveTicketModal({ ticketId, visible, onClose, onRemoved, testID = 'remove-ticket' }: RemoveTicketModalProps) {
  const ticket = useAgentTicket(ticketId);
  const stop = useStopSession(ticketId);
  const archive = useArchiveTicket();
  const [deleteMerged, setDeleteMerged] = useState(false);
  const [unmerged, setUnmerged] = useState<UnmergedWork | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = stop.isPending || archive.isPending;

  const remove = async (discardUnmerged: boolean) => {
    setFailure(null);
    // The session goes first, so its process never writes into a worktree that is being removed.
    await stop.mutateAsync().catch(() => undefined);
    archive.mutate(
      { ticketId, discardUnmerged, deleteMergedBranches: deleteMerged },
      {
        onSuccess: (result) => {
          if (result.status === 'archived') {
            toast({ id: `removed:${ticketId}`, tone: 'success', title: `Removed ${ticket?.ado ? `#${ticket.ado.workItemId}` : ticketId} from the board`, body: 'Its worktree is gone; the record is in the archive list.' });
            onClose();
            onRemoved?.();
          } else {
            setFailure(`Some worktrees could not be removed yet: ${result.leftovers.map((item) => `${item.target} (${item.reason})`).join('; ')}. The ticket stays on the board; try again.`);
          }
        },
        onError: (error) => {
          const work = unmergedOf(error);
          if (work) setUnmerged(work);
          else setFailure(error instanceof Error ? error.message : String(error));
        },
      },
    );
  };

  const close = () => {
    if (busy) return;
    setUnmerged(null);
    setFailure(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={unmerged ? 'Remove it with unmerged work?' : 'Remove this ticket from the board?'}
      subtitle={ticket ? ticket.title : ticketId}
      icon="archive"
      onClose={close}
      width={520}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label="Keep it" onPress={close} disabled={busy} />
          {unmerged ? (
            <Button variant="danger" label="Remove anyway" onPress={() => void remove(true)} loading={busy} testID={`${testID}-confirm-discard`} />
          ) : (
            <Button variant="danger" label="Remove from board" onPress={() => void remove(false)} loading={busy} testID={`${testID}-confirm`} />
          )}
        </View>
      }
      testID={`${testID}-modal`}
    >
      <View style={styles.body}>
        {unmerged ? (
          <>
            <Text variant="body" size="md">
              This work is not merged anywhere yet and would be lost with the worktree:
            </Text>
            <View style={styles.list} testID={`${testID}-unmerged`}>
              {unmerged.branches.map((branch) => (
                <Text key={branch.branch} variant="mono" size="sm" selectable>
                  {`${branch.branch} · ${branch.commits} unmerged ${branch.commits === 1 ? 'commit' : 'commits'}`}
                </Text>
              ))}
              {unmerged.dirtyWorktrees.map((path) => (
                <Text key={path} variant="mono" size="sm" selectable>
                  {`${path} · uncommitted changes`}
                </Text>
              ))}
            </View>
            <Text variant="body" size="sm" color={color.muted}>
              Unmerged branches are kept in the repo; only the worktree folders are removed.
            </Text>
          </>
        ) : (
          <>
            <Text variant="body" size="md">
              The agent session ends, the ticket worktree and any sub-agent worktrees are removed, and the card leaves the board. The ticket's branches stay in the repo and its record goes to the archive list.
            </Text>
            <Switch
              label={`Also delete branches already merged into ${ticket?.baseBranch ?? 'the base branch'}`}
              value={deleteMerged}
              onValueChange={setDeleteMerged}
              stateText={{ on: 'Delete', off: 'Keep' }}
              disabled={busy}
              testID={`${testID}-delete-merged`}
            />
          </>
        )}
        {failure ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID={`${testID}-error`}>
            {failure}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.md,
  },
  list: {
    gap: space.xs,
    padding: space.md,
    borderRadius: 8,
    backgroundColor: color.bg,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
});
