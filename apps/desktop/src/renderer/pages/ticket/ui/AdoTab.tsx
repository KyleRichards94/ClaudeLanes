import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { formatPullRequestChecks, type PullRequestCheck, type PullRequestRef, type WorkItem, type WorkItemComment } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Pill, Text, type PillTone } from '@agent-lanes/ui';
import { WorkItemChip } from '@/entities/ado-work-item';
import type { AgentTicket } from '@/entities/agent-ticket';
import { usePullRequest, useWorkItem, useWorkItemComments } from '@/shared/api';
import { RichText } from './RichText';

export interface AdoTabProps {
  ticket: Pick<AgentTicket, 'ado' | 'pullRequest'>;
  /**
   * The linked pull request's project, repository and id, when the ticket keeps them (AL-181). With
   * it the tab lists every check; without it, the counts the ticket's events carry.
   */
  pullRequestRef?: PullRequestRef | null;
}

/**
 * The drill-in's ADO tab (AL-180, artboard 3 tabs, R6): the work item's fields, its description and
 * acceptance criteria, its discussion (Agent Lanes write-backs marked), and the linked pull request
 * with its checks. ADO's HTML is read into React Native text by `RichText` and never rendered as HTML.
 */
export function AdoTab({ ticket, pullRequestRef = null }: AdoTabProps) {
  const workItemId = ticket.ado?.workItemId;
  const workItem = useWorkItem(workItemId);

  if (!ticket.ado) {
    return (
      <View style={styles.tab} testID="ticket-tab-ado">
        <Text variant="meta" size="md" testID="ado-no-work-item">
          This ticket has no Azure DevOps work item.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.tab} testID="ticket-tab-ado">
      {workItem.isPending ? (
        <Text variant="meta" size="md" aria-busy testID="ado-loading">
          Loading the work item…
        </Text>
      ) : workItem.isError ? (
        <View style={styles.section}>
          <Text variant="meta" size="md" color={tone.danger.text} testID="ado-error">
            {`Couldn't load work item #${ticket.ado.workItemId}. ${workItem.error.message}`}
          </Text>
          <Button label="Retry" size="sm" onPress={() => void workItem.refetch()} style={styles.start} />
        </View>
      ) : (
        <>
          <WorkItemFields item={workItem.data} />
          <Section title="Description" testID="ado-description">
            {workItem.data.description ? <RichText source={workItem.data.description} /> : <Empty>No description.</Empty>}
          </Section>
          <Section title="Acceptance criteria" testID="ado-acceptance-criteria">
            {workItem.data.acceptanceCriteria ? <RichText source={workItem.data.acceptanceCriteria} /> : <Empty>No acceptance criteria.</Empty>}
          </Section>
        </>
      )}
      <PullRequestSection summary={ticket.pullRequest} pullRequestRef={pullRequestRef} />
      {/* The ticket keeps the work item's project, so comments load even when the item itself can't. */}
      <Comments workItemId={ticket.ado.workItemId} project={workItem.data?.project ?? ticket.ado.project} />
    </View>
  );
}

/**
 * The work item chip and the fields the header band's chip does not already show (AL-254): type, state,
 * sprint and assignee live in the header; the tab adds the project and the area.
 */
function WorkItemFields({ item }: { item: WorkItem }) {
  const fields: [string, string][] = [
    ['Project', item.project],
    ['Iteration', item.iterationPath || '—'],
  ];
  return (
    <View style={styles.section} testID="ado-fields">
      <WorkItemChip item={item} testID="ticket-work-item" />
      <View style={styles.fields}>
        {fields.map(([label, value]) => (
          <View key={label} style={styles.field}>
            <Text variant="meta">{label}</Text>
            <Text variant="body" numberOfLines={1} selectable>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Section({ title, children, aside, testID }: { title: string; children: ReactNode; aside?: ReactNode; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        <Text variant="title" role="heading" aria-level={2}>
          {title}
        </Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <Text variant="meta" size="md">
      {children}
    </Text>
  );
}

const PR_STATUS: Record<NonNullable<AgentTicket['pullRequest']>['status'], { label: string; tone: PillTone }> = {
  active: { label: 'Active', tone: 'ado' },
  completed: { label: 'Completed', tone: 'ok' },
  abandoned: { label: 'Abandoned', tone: 'neutral' },
};

const CHECK_TONE: Record<PullRequestCheck['state'], PillTone> = { passed: 'ok', failed: 'danger', pending: 'neutral' };
const CHECK_LABEL: Record<PullRequestCheck['state'], string> = { passed: 'Passed', failed: 'Failed', pending: 'Pending' };

function PullRequestSection({ summary, pullRequestRef }: { summary: AgentTicket['pullRequest']; pullRequestRef: PullRequestRef | null }) {
  const detail = usePullRequest(pullRequestRef);
  const snapshot = detail.data;
  const id = snapshot?.pullRequest.id ?? summary?.id;
  const status = snapshot?.pullRequest.status ?? summary?.status;
  const counts = snapshot?.checks ?? summary?.checks ?? null;

  if (id === undefined || status === undefined) {
    return (
      <Section title="Pull request" testID="ado-pull-request">
        <Empty>No pull request yet. The Create PR stage opens one and links it to the work item.</Empty>
      </Section>
    );
  }
  return (
    <Section title="Pull request" testID="ado-pull-request">
      <View style={styles.prRow}>
        <Text variant="title" color={tone.ado.text} testID="ado-pull-request-id">{`PR !${id}`}</Text>
        <Pill label={PR_STATUS[status].label} tone={PR_STATUS[status].tone} dot />
        {counts ? (
          <Text variant="meta" size="md" testID="ado-pull-request-checks">
            {formatPullRequestChecks(counts)}
            {counts.pending > 0 ? ` · ${counts.pending} pending` : ''}
          </Text>
        ) : null}
        {snapshot ? (
          <Pressable role="link" aria-label="Open the pull request in Azure DevOps" onPress={() => void Linking.openURL(snapshot.pullRequest.webUrl)} style={styles.link}>
            <Text variant="title" color={tone.ado.text}>
              Open
            </Text>
            <Icon name="arrow-up-right" color={tone.ado.text} size={14} />
          </Pressable>
        ) : null}
      </View>
      {snapshot ? (
        <>
          <Text variant="body" selectable>
            {snapshot.pullRequest.title}
          </Text>
          <View style={styles.list} role="list" aria-label="Checks">
            {snapshot.checks.checks.map((check) => (
              <View key={check.id} style={styles.check} role="listitem" testID="ado-check">
                <Pill label={CHECK_LABEL[check.state]} tone={CHECK_TONE[check.state]} dot />
                <View style={styles.checkText}>
                  <Text variant="body" numberOfLines={1}>
                    {check.required ? check.name : `${check.name} (optional)`}
                  </Text>
                  {check.detail ? (
                    <Text variant="meta" numberOfLines={2} selectable>
                      {check.detail}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Section>
  );
}

function Comments({ workItemId, project }: { workItemId: number; project: string }) {
  const comments = useWorkItemComments(workItemId, project);
  return (
    <Section
      title="Comments"
      testID="ado-comments"
      aside={comments.data ? <Text variant="meta">{`${comments.data.length}`}</Text> : null}
    >
      {comments.isPending ? (
        <Empty>Loading comments…</Empty>
      ) : comments.isError ? (
        <View style={styles.section}>
          <Text variant="meta" size="md" color={tone.danger.text}>
            {`Couldn't load the comments. ${comments.error.message}`}
          </Text>
          <Button label="Retry" size="sm" onPress={() => void comments.refetch()} style={styles.start} />
        </View>
      ) : comments.data.length === 0 ? (
        <Empty>No comments yet.</Empty>
      ) : (
        <View style={styles.list} role="list" aria-label="Comments">
          {comments.data.map((comment) => (
            <CommentRow key={comment.id} comment={comment} />
          ))}
        </View>
      )}
    </Section>
  );
}

function CommentRow({ comment }: { comment: WorkItemComment }) {
  return (
    <View style={[styles.comment, comment.fromAgentLanes && styles.commentAgent]} role="listitem" testID="ado-comment">
      <View style={styles.commentHeader}>
        <Text variant="title" numberOfLines={1}>
          {comment.author ?? 'Unknown'}
        </Text>
        {comment.fromAgentLanes ? <Pill label="Agent Lanes" tone="claude" testID="ado-comment-agent-lanes" /> : null}
        <Text variant="meta">{formatCommentTime(comment.createdAt)}</Text>
        {comment.updatedAt ? <Text variant="meta">edited</Text> : null}
      </View>
      <RichText source={comment.text} format={comment.format} />
    </View>
  );
}

/** "8 Oct 14:02" in the viewer's time zone. */
export function formatCommentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

const styles = StyleSheet.create({
  tab: {
    gap: space.xl,
  },
  section: {
    gap: space.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  start: {
    alignSelf: 'flex-start',
  },
  fields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  field: {
    gap: space.xs,
    minWidth: 120,
    alignItems: 'flex-start',
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 44,
  },
  list: {
    gap: space.sm,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  checkText: {
    flex: 1,
    minWidth: 0,
  },
  comment: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  // Write-backs from the app wear the Claude violet, as Claude activity does everywhere (design §11).
  commentAgent: {
    borderColor: tone.claude.border,
    backgroundColor: tone.claude.wash,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
