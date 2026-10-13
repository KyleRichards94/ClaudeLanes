import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { UnmergedWork } from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, Modal, Switch, Text } from '@agent-lanes/ui';
import { agentTickets, selectTicket, useArchiveTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { invoke } from '@/shared/api';
import { toast } from '@/shared/model';
import { unmergedOf } from '../model/unmerged';

export interface BulkRemoveModalProps {
  /** "Done", "QA only": named in the title. */
  laneName: string;
  /** The cards to remove, as the lane shows them now. */
  ticketIds: readonly string[];
  visible: boolean;
  onClose(): void;
  store?: AgentTicketStore;
  testID?: string;
}

interface Held {
  ticketId: string;
  work: UnmergedWork;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Remove every card in a lane from the board at once (Done and the single-step lanes): one by one, each
 * ticket's session ends and it is archived as Remove does it. Tickets with unmerged commits or uncommitted
 * changes are held back on the first pass and listed; "Remove these anyway" takes them too.
 */
export function BulkRemoveModal({ laneName, ticketIds, visible, onClose, store = agentTickets, testID = 'bulk-remove' }: BulkRemoveModalProps) {
  const archive = useArchiveTicket(store);
  const [deleteMerged, setDeleteMerged] = useState(false);
  const [held, setHeld] = useState<Held[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const label = (ticketId: string) => {
    const ticket = selectTicket(store.getState(), ticketId);
    return ticket?.ado ? `#${ticket.ado.workItemId}` : ticketId;
  };

  const run = async (ids: readonly string[], discardUnmerged: boolean) => {
    setBusy(true);
    setFailures([]);
    const nowHeld: Held[] = [];
    const failed: string[] = [];
    let removed = 0;
    for (const [index, ticketId] of ids.entries()) {
      setProgress(`Removing ${label(ticketId)} (${index + 1} of ${ids.length})…`);
      // The session goes first, so its process never writes into a worktree that is being removed.
      await invoke('agent:stop', { ticketId }).catch(() => undefined);
      try {
        const result = await archive.mutateAsync({ ticketId, discardUnmerged, deleteMergedBranches: deleteMerged });
        if (result.status === 'archived') removed += 1;
        else failed.push(`${label(ticketId)}: some worktrees could not be removed yet (${result.leftovers.map((item) => item.reason).join(', ')})`);
      } catch (error) {
        const work = unmergedOf(error);
        if (work) nowHeld.push({ ticketId, work });
        else failed.push(`${label(ticketId)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setBusy(false);
    setProgress(null);
    setHeld(nowHeld);
    setFailures(failed);
    if (removed > 0) {
      toast({ id: `bulk-removed:${laneName}`, tone: 'success', title: `Removed ${plural(removed, 'ticket')} from ${laneName}`, body: 'Their worktrees are gone; the records are in the archive list.' });
    }
    if (nowHeld.length === 0 && failed.length === 0) onClose();
  };

  const close = () => {
    if (busy) return;
    setHeld([]);
    setFailures([]);
    onClose();
  };

  const confirmingHeld = held.length > 0;
  return (
    <Modal
      visible={visible}
      title={confirmingHeld ? `Remove ${plural(held.length, 'ticket')} with unmerged work?` : `Remove all ${plural(ticketIds.length, 'ticket')} from ${laneName}?`}
      subtitle={confirmingHeld ? 'The rest were removed.' : 'Each one is removed as Remove from board does it.'}
      icon="archive"
      onClose={close}
      width={560}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label={confirmingHeld ? 'Keep these' : 'Cancel'} onPress={close} disabled={busy} />
          {confirmingHeld ? (
            <Button variant="danger" label="Remove these anyway" onPress={() => void run(held.map((entry) => entry.ticketId), true)} loading={busy} testID={`${testID}-confirm-discard`} />
          ) : (
            <Button variant="danger" label={`Remove ${plural(ticketIds.length, 'ticket')}`} disabled={ticketIds.length === 0} onPress={() => void run(ticketIds, false)} loading={busy} testID={`${testID}-confirm`} />
          )}
        </View>
      }
      testID={`${testID}-modal`}
    >
      <View style={styles.body}>
        {confirmingHeld ? (
          <>
            <Text variant="body" size="md">
              This work is not merged anywhere yet and would be lost with the worktrees:
            </Text>
            <View style={styles.list} testID={`${testID}-unmerged`}>
              {held.map(({ ticketId, work }) => (
                <View key={ticketId} style={styles.entry}>
                  <Text variant="title" size="sm">
                    {label(ticketId)}
                  </Text>
                  {work.branches.map((branch) => (
                    <Text key={branch.branch} variant="mono" size="sm" selectable>
                      {`${branch.branch} · ${plural(branch.commits, 'unmerged commit')}`}
                    </Text>
                  ))}
                  {work.dirtyWorktrees.map((path) => (
                    <Text key={path} variant="mono" size="sm" selectable>
                      {`${path} · uncommitted changes`}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
            <Text variant="body" size="sm" color={color.muted}>
              Unmerged branches are kept in the repo; only the worktree folders are removed.
            </Text>
          </>
        ) : (
          <>
            <Text variant="body" size="md">
              Each agent session ends, the worktrees are removed and the cards leave the board. Branches stay in the repo and the records go to the archive list. Tickets with unmerged work are held back and listed before anything of theirs is removed.
            </Text>
            <Switch
              label="Also delete branches already merged into their base branch"
              value={deleteMerged}
              onValueChange={setDeleteMerged}
              stateText={{ on: 'Delete', off: 'Keep' }}
              disabled={busy}
              testID={`${testID}-delete-merged`}
            />
          </>
        )}
        {progress ? (
          <Text variant="meta" size="sm" role="status" testID={`${testID}-progress`}>
            {progress}
          </Text>
        ) : null}
        {failures.length > 0 ? (
          <View role="alert" testID={`${testID}-error`}>
            {failures.map((failure) => (
              <Text key={failure} variant="body" size="sm" color={tone.danger.text}>
                {failure}
              </Text>
            ))}
          </View>
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
    gap: space.sm,
    padding: space.md,
    borderRadius: 8,
    backgroundColor: color.bg,
  },
  entry: {
    gap: space.xs,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
});
