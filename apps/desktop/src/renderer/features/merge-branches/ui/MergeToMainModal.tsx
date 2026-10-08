import { StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Modal, Text } from '@agent-lanes/ui';
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

  const close = () => {
    merge.reset();
    onClose();
  };

  const dirtyFiles = failure?.code === 'GIT_DIRTY' ? failure.files : [];
  const dirty = data?.worktree.dirty === true || failure?.code === 'GIT_DIRTY';
  const missing = data !== undefined && !data.worktree.present;
  const qaWarning = data !== undefined && !data.qaPassed;
  const blocked = data === undefined || dirty || missing || data.worktree.conflicted;

  const onConfirm = () =>
    merge.mutate(
      { ticketId: ticket.id, ...(qaWarning ? { acceptQaWarning: true } : {}) },
      {
        onSuccess: (result) => {
          toast({
            id: `merge-main:${ticket.id}`,
            tone: 'success',
            title: `Merged into ${result.target} · ${clockTime(result.mergedAt)}`,
            body: result.pushed ? `${ticket.branch} is merged and pushed.` : 'The repo has no origin remote, so nothing was pushed.',
          });
          close();
        },
      },
    );

  const target = data?.target ?? ticket.baseBranch;
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
            <Text variant="body" testID="merge-to-main-summary">
              {data.alreadyMerged
                ? `${data.source} is already part of ${data.target}. Merging pushes ${data.target} and moves the card to Done.`
                : `${plural(data.ahead ?? 0, 'commit')} on ${data.source} merge into ${data.target} with a merge commit, then ${data.target} is pushed and the card moves to Done.`}
            </Text>
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
