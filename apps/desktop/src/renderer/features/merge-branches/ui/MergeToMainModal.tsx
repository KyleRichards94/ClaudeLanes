import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MergeTarget } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Modal, SegmentedControl, Text } from '@agent-lanes/ui';
import { agentTickets, clockTime, useMergeToMain, useMergeToMainPreview, type AgentTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { toast } from '@/shared/model';
import { mergeErrorInfo } from '../model/conflict';
import { FileList } from './FileList';

export interface MergeToMainModalProps {
  visible: boolean;
  ticket: Pick<AgentTicket, 'id' | 'branch' | 'baseBranch'>;
  store?: AgentTicketStore;
  onClose(): void;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Merge worktree → main's confirm (AL-174, design §9 step 5, R9): names what merges into what,
 * warns when QA has not passed (the button becomes "Merge anyway"), and refuses a worktree with
 * uncommitted changes. A conflict is listed here; nothing was changed by it.
 */
export function MergeToMainModal({ visible, ticket, store = agentTickets, onClose }: MergeToMainModalProps) {
  // The preview is read each time the modal opens, so the warnings are current.
  const preview = useMergeToMainPreview(ticket.id, { enabled: visible });
  const merge = useMergeToMain(store);
  const data = preview.data;
  const failure = merge.error ? mergeErrorInfo(merge.error) : null;
  // AL-271: into the main checkout's branch by default (no push); the base branch with a push as the second choice.
  const [choice, setChoice] = useState<MergeTarget | null>(null);
  const targetKind: MergeTarget = choice ?? (data && data.checkoutBranch === null ? 'base' : 'checkout');
  const checkoutUnavailable = data !== undefined && data.checkoutBranch === null;
  const targetName = targetKind === 'base' ? (data?.target ?? ticket.baseBranch) : (data?.checkoutBranch ?? 'the main checkout');

  const close = () => {
    merge.reset();
    setChoice(null);
    onClose();
  };

  const dirtyFiles = failure?.code === 'GIT_DIRTY' ? failure.files : [];
  const dirty = data?.worktree.dirty === true || failure?.code === 'GIT_DIRTY';
  const missing = data !== undefined && !data.worktree.present;
  const qaWarning = data !== undefined && !data.qaPassed;
  const checkoutBlocked = targetKind === 'checkout' && (checkoutUnavailable || data?.checkoutClean === false);
  const blocked = data === undefined || dirty || missing || data.worktree.conflicted || checkoutBlocked;

  const onConfirm = () =>
    merge.mutate(
      { ticketId: ticket.id, target: targetKind, ...(qaWarning ? { acceptQaWarning: true } : {}) },
      {
        onSuccess: (result) => {
          toast({
            id: `merge-main:${ticket.id}`,
            tone: 'success',
            title: `Merged into ${result.target} · ${clockTime(result.mergedAt)}`,
            body:
              result.targetKind === 'checkout'
                ? `${ticket.branch} is merged into the main checkout; nothing was pushed.`
                : result.pushed
                  ? `${ticket.branch} is merged and pushed.`
                  : 'The repo has no origin remote, so nothing was pushed.',
          });
          close();
        },
      },
    );

  const target = targetName;
  return (
    <Modal
      visible={visible}
      title={`Merge worktree → ${target}`}
      subtitle={`${data?.source ?? ticket.branch} into ${target}${data ? ` in ${data.repo}` : ''}`}
      icon="merge"
      width={560}
      onClose={close}
      testID="merge-to-main-modal"
      footer={
        <>
          <Button label="Cancel" onPress={close} />
          <Button
            label={qaWarning ? 'Merge anyway' : `Merge into ${target}`}
            variant="strong"
            trailingIcon="arrow-right"
            disabled={blocked}
            loading={merge.isPending}
            onPress={onConfirm}
            testID="merge-to-main-confirm"
          />
        </>
      }
    >
      <View style={styles.body}>
        {preview.isPending ? (
          <Text variant="meta" size="md">
            Checking the worktree…
          </Text>
        ) : preview.isError ? (
          <Notice tone="danger" title="Couldn't check the worktree" body={preview.error.message} testID="merge-to-main-preview-error" />
        ) : data ? (
          <>
            <SegmentedControl<MergeTarget>
              label="Merge into"
              value={targetKind}
              onChange={setChoice}
              options={[
                { value: 'checkout', label: data.checkoutBranch ? `${data.checkoutBranch} (main checkout)` : 'Main checkout' },
                { value: 'base', label: `${data.target} and push` },
              ]}
              fill
              testID="merge-to-main-target"
            />
            <Text variant="body" testID="merge-to-main-summary">
              {targetKind === 'checkout'
                ? checkoutUnavailable
                  ? `The main checkout has no branch checked out, so the merge can only go into ${data.target}.`
                  : `${plural(data.ahead ?? 0, 'commit')} on ${data.source} merge into ${data.checkoutBranch} in ${data.repo} with a merge commit. Nothing is pushed; the card moves to Done.`
                : data.alreadyMerged
                  ? `${data.source} is already part of ${data.target}. Merging pushes ${data.target} and moves the card to Done.`
                  : `${plural(data.ahead ?? 0, 'commit')} on ${data.source} merge into ${data.target} with a merge commit, then ${data.target} is pushed and the card moves to Done.`}
            </Text>
            {targetKind === 'checkout' && data.checkoutBranch !== null && !data.checkoutClean ? (
              <Notice tone="danger" title="The main checkout has uncommitted changes" body={`Commit or stash them in ${data.repo} before merging into ${data.checkoutBranch}.`} testID="merge-to-main-checkout-dirty" />
            ) : null}
            {dirty ? (
              <Notice
                tone="danger"
                title="The worktree has uncommitted changes"
                body={`Commit or discard ${data.worktree.changedFiles ? plural(data.worktree.changedFiles, 'change') : 'them'} before merging.`}
                files={dirtyFiles}
                testID="merge-to-main-dirty"
              />
            ) : missing ? (
              <Notice tone="danger" title="The worktree is missing" body="Its folder was deleted outside Agent Lanes." testID="merge-to-main-missing" />
            ) : data.worktree.conflicted ? (
              <Notice tone="danger" title="A merge is stopped on conflicts" body="Resolve it before merging into main." testID="merge-to-main-conflicted" />
            ) : null}
            {qaWarning && !dirty ? (
              <Notice
                tone="attention"
                title="QA has not passed"
                body="This ticket hasn't been through QA. Merging now skips it."
                testID="merge-to-main-qa-warning"
              />
            ) : null}
            {failure && failure.code === 'MERGE_CONFLICT' ? (
              <Notice
                tone="danger"
                title={`Merging would conflict with ${data.target}`}
                body="Nothing was changed. Bring the base into the ticket branch and resolve the conflicts first."
                files={failure.files}
                testID="merge-to-main-conflict"
              />
            ) : failure && failure.code !== 'GIT_DIRTY' ? (
              <Notice tone="danger" title="The merge didn't go through" body={failure.message} testID="merge-to-main-error" />
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function Notice({
  tone: noticeTone,
  title,
  body,
  files = [],
  testID,
}: {
  tone: 'attention' | 'danger';
  title: string;
  body: string;
  files?: readonly string[];
  testID: string;
}) {
  const colors = tone[noticeTone];
  return (
    <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.band }]} role={noticeTone === 'danger' ? 'alert' : undefined} testID={testID}>
      <View style={styles.noticeHeader}>
        <Icon name="alert" color={colors.text} size={16} />
        <Text variant="title" color={colors.text}>
          {title}
        </Text>
      </View>
      <Text variant="body" size="sm" color={colors.text}>
        {body}
      </Text>
      {files.length > 0 ? <FileList files={files} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.md,
  },
  notice: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    backgroundColor: color.surface,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
