import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, minTarget, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Text } from '@agent-lanes/ui';
import { agentTickets, useMergeSubBranches, type AgentTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { useBranchStatus, useSessionStatus } from '@/shared/api';
import { showErrorRecovery, toast } from '@/shared/model';
import { mergeErrorInfo, type MergeErrorInfo } from '../model/conflict';
import { mergePanel, type BranchStatusState, type MergePanel } from '../model/merge-panel';
import { ConflictModal } from './ConflictModal';
import { MergeToMainModal } from './MergeToMainModal';

export interface MergeControlsProps {
  ticket: Pick<AgentTicket, 'id' | 'branch' | 'baseBranch' | 'stage'>;
  /** The store a merge to main moves the card in; the app's own by default. */
  store?: AgentTicketStore;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The Merge panel's body (AL-174, artboard 3, design §9 steps 4–5, R9): "Merge N sub-branches →
 * <ticket branch>" and the dark "Merge worktree → main". Each is off with its reason when nothing is
 * ready or the worktree is dirty. Merge worktree → main asks first in a confirm modal (QA warning,
 * dirty refusal); a sub-branch merge that stops on a conflict opens the conflict view with "Hand to
 * lead agent" and "Open in editor", which stays one press away until the conflict is resolved.
 */
export function MergeControls({ ticket, store = agentTickets }: MergeControlsProps) {
  const status = useBranchStatus(ticket.id);
  const session = useSessionStatus(ticket.id);
  const mergeSubs = useMergeSubBranches(store);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [conflict, setConflict] = useState<MergeErrorInfo | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const state: BranchStatusState =
    status.data !== undefined ? { status: 'success', data: status.data } : status.isError ? { status: 'error' } : { status: 'pending' };
  // Merge → main waits while the agent is in a turn (AL-254).
  const view = mergePanel(ticket, state, { agentBusy: session.data?.state === 'running' || session.data?.state === 'starting' });

  const onMergeSubs = () =>
    mergeSubs.mutate(
      { ticketId: ticket.id },
      {
        onSuccess: (result) => {
          const skipped = result.skipped.filter((sub) => sub.reason === 'not-ready').length;
          toast({
            id: `merge-subs:${ticket.id}`,
            tone: 'success',
            title: `Merged ${plural(result.merged.length, 'sub-branch', 'sub-branches')} into ${result.target}`,
            body: skipped > 0 ? `${plural(skipped, 'sub-branch', 'sub-branches')} weren't ready and wait for the next merge.` : undefined,
          });
        },
        onError: (error) => {
          const info = mergeErrorInfo(error);
          if (info.code === 'MERGE_CONFLICT') {
            setConflict(info);
            setConflictOpen(true);
          } else {
            showErrorRecovery(info, { ticketId: ticket.id });
          }
        },
      },
    );

  return (
    <>
      <MergeControlsView
        view={view}
        target={ticket.branch}
        merging={mergeSubs.isPending}
        onMergeSubBranches={onMergeSubs}
        onMergeToMain={() => setConfirmOpen(true)}
        onViewConflict={() => setConflictOpen(true)}
      />
      <MergeToMainModal visible={confirmOpen} ticket={ticket} store={store} onClose={() => setConfirmOpen(false)} />
      <ConflictModal visible={conflictOpen} ticket={ticket} conflict={conflict} onClose={() => setConflictOpen(false)} />
    </>
  );
}

export interface MergeControlsViewProps {
  view: MergePanel;
  /** The branch sub-branches merge into, shown under the button (AL-254). */
  target?: string;
  /** Merge sub-branches is in flight. */
  merging?: boolean;
  onMergeSubBranches(): void;
  onMergeToMain(): void;
  onViewConflict(): void;
}

/** The two merge buttons, the reason they are off and the conflict row, with no actions behind them (also the gallery's samples). */
export function MergeControlsView({ view, target, merging = false, onMergeSubBranches, onMergeToMain, onViewConflict }: MergeControlsViewProps) {
  // The reason a button is off, said once under both when they share it (a dirty worktree).
  const reasons = [...new Set([view.subBranches.disabledReason, view.toMain.disabledReason].filter((reason): reason is string => reason !== null))];
  return (
    <View style={styles.body} testID="merge-controls">
      <Button
        label={view.subBranches.label}
        trailingIcon="merge"
        justify="between"
        disabled={view.subBranches.disabledReason !== null}
        loading={merging}
        onPress={onMergeSubBranches}
        testID="merge-sub-branches"
      />
      {target && view.readyCount > 0 ? (
        <Text variant="mono" size="xs" color={color.muted} numberOfLines={1} selectable testID="merge-sub-branches-target">
          {`→ ${target}`}
        </Text>
      ) : null}
      <Button
        label={view.toMain.label}
        variant="strong"
        trailingIcon="arrow-right"
        justify="between"
        disabled={view.toMain.disabledReason !== null}
        onPress={onMergeToMain}
        testID="merge-to-main"
      />
      {view.conflicted ? (
        <Pressable
          role="button"
          aria-label="Merge stopped on conflicts. View conflicts"
          onPress={onViewConflict}
          style={styles.conflictRow}
          testID="merge-conflict-row"
        >
          <Icon name="alert" color={tone.attention.text} size={16} />
          <Text variant="title" size="sm" color={tone.attention.text} style={styles.flexText} numberOfLines={1}>
            Merge stopped on conflicts
          </Text>
          <Text variant="title" size="sm" color={tone.attention.text}>
            View
          </Text>
        </Pressable>
      ) : reasons.length > 0 ? (
        <View testID="merge-disabled-reasons">
          {reasons.map((reason) => (
            <Text key={reason} variant="meta">
              {reason}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.sm,
  },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: minTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: tone.attention.border,
    backgroundColor: tone.attention.band,
  },
  flexText: {
    flex: 1,
  },
});

