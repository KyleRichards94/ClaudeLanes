import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import {
  PULL_REQUEST_DESCRIPTION_MAX,
  PULL_REQUEST_TITLE_MAX,
  formatPullRequestChecks,
  pullRequestOutcome,
  type PullRequestCheck,
  type PullRequestOutcome,
  type TicketPullRequest,
} from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, GlassPanel, Pill, Text, TextField, type PillTone } from '@agent-lanes/ui';
import type { AgentTicket } from '@/entities/agent-ticket';
import { ErrorBoundary } from '@/shared/ui';
import { useCreatePullRequest, usePullRequestDraft, useTicketPullRequest } from '../api/pull-request';

export interface CreatePullRequestPanelProps {
  ticket: AgentTicket;
  /** The PR the record keeps (AL-181); null or undefined before one is created. */
  saved: TicketPullRequest | null | undefined;
}

const OUTCOME_PILLS: Record<PullRequestOutcome, { label: string; tone: PillTone }> = {
  open: { label: 'Open', tone: 'ado' },
  merged: { label: 'Merged', tone: 'ok' },
  abandoned: { label: 'Abandoned', tone: 'neutral' },
};

const CHECK_PILLS: Record<PullRequestCheck['state'], { label: string; tone: PillTone }> = {
  passed: { label: 'Passed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  pending: { label: 'Pending', tone: 'neutral' },
};

/**
 * The Create PR stage on the drill-in (AL-181, design §7 ADO write-back, §9 alternative to step 5,
 * artboard 6 "PR open"). Once the ticket is in Create PR (its gate approved), the form starts from a
 * draft of the agent's summary; the user edits it and creates the PR, which main opens from the pushed
 * ticket branch and links to the work item. Afterwards the panel shows the PR, its status and its
 * checks, read again every 30 s; a completed or abandoned PR moves the ticket to Done.
 */
export function CreatePullRequestPanel({ ticket, saved }: CreatePullRequestPanelProps) {
  const hasPr = Boolean(saved) || ticket.pullRequest !== null;
  return (
    <GlassPanel style={styles.panel} testID="pull-request-panel">
      <ErrorBoundary name="panel:pull-request" label="the pull request panel">
        <Text variant="title" role="heading" aria-level={2}>
          Pull request
        </Text>
        {hasPr ? <PullRequestStatus ticketId={ticket.id} saved={saved} /> : <PullRequestForm ticketId={ticket.id} />}
      </ErrorBoundary>
    </GlassPanel>
  );
}

function PullRequestForm({ ticketId }: { ticketId: string }) {
  const draft = usePullRequestDraft(ticketId, true);
  const create = useCreatePullRequest();
  // Null until the user edits a field: the field shows the draft, and what the user types is never overwritten.
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  if (draft.isPending) {
    return (
      <Text variant="meta" aria-busy>
        Drafting the pull request from the agent&apos;s summary…
      </Text>
    );
  }
  if (draft.isError) {
    return (
      <Text variant="meta" color={tone.danger.text} role="alert">
        {draft.error.message}
      </Text>
    );
  }
  const data = draft.data;
  const blocked = data.blocked;
  const titleText = title ?? data.title;
  const titleError = titleText.trim() ? null : 'A pull request needs a title.';

  return (
    <View style={styles.form}>
      <Text variant="meta" testID="pull-request-target">
        {[
          `${data.sourceBranch} → ${data.targetBranch}`,
          data.repository,
          data.workItemId !== null ? `Links work item #${data.workItemId}` : 'No work item to link',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <TextField label="Title" value={titleText} onChangeText={setTitle} maxLength={PULL_REQUEST_TITLE_MAX} error={titleError} testID="pull-request-title" />
      <TextField
        label="Description"
        variant="multiline"
        rows={6}
        value={description ?? data.description}
        onChangeText={setDescription}
        maxLength={PULL_REQUEST_DESCRIPTION_MAX}
        help="Drafted from the agent's summary. Markdown, as Azure DevOps shows it."
        testID="pull-request-description"
      />
      {blocked ? (
        <Text variant="meta" color={tone.attention.text} testID="pull-request-blocked">
          {blocked}
        </Text>
      ) : null}
      {create.isError ? (
        <Text variant="meta" color={tone.danger.text} role="alert" testID="pull-request-error">
          {create.error.message}
        </Text>
      ) : null}
      <Button
        label="Create pull request"
        variant="primary"
        trailingIcon="arrow-right"
        style={styles.submit}
        disabled={Boolean(blocked) || Boolean(titleError)}
        loading={create.isPending}
        onPress={() => create.mutate({ ticketId, title: titleText.trim(), description: description ?? data.description })}
        testID="pull-request-create"
      />
    </View>
  );
}

function PullRequestStatus({ ticketId, saved }: { ticketId: string; saved: TicketPullRequest | null | undefined }) {
  const query = useTicketPullRequest(ticketId, true);
  const state = query.data;
  const pr = state?.pullRequest ?? saved;
  if (!pr) {
    return <Text variant="meta">Reading the pull request…</Text>;
  }
  const outcome = pullRequestOutcome(pr);
  const pill = OUTCOME_PILLS[outcome];
  const checks = state?.snapshot.checks;
  return (
    <View style={styles.form}>
      <View style={styles.headline}>
        <Text variant="mono" testID="pull-request-id">{`PR !${pr.id}`}</Text>
        <Pill label={pill.label} tone={pill.tone} testID="pull-request-status" />
        {checks ? (
          <Text variant="meta" testID="pull-request-checks">
            {formatPullRequestChecks(checks)}
          </Text>
        ) : null}
        <View style={styles.spacer} />
        <Button label="Refresh" icon="refresh" iconOnly size="sm" loading={query.isFetching} onPress={() => void query.refetch()} testID="pull-request-refresh" />
        <Button label="Open in Azure DevOps" size="sm" trailingIcon="arrow-up-right" onPress={() => void Linking.openURL(pr.webUrl)} testID="pull-request-open" />
      </View>
      {state ? <Text variant="body">{state.snapshot.pullRequest.title}</Text> : null}
      {checks && checks.checks.length > 0 ? (
        <View role="list" aria-label="Checks" style={styles.checks}>
          {checks.checks.map((check) => (
            <View key={check.id} role="listitem" style={styles.check}>
              <Text variant="body" numberOfLines={1} style={styles.checkName}>
                {check.required ? check.name : `${check.name} (optional)`}
              </Text>
              {check.detail ? (
                <Text variant="meta" numberOfLines={1} style={styles.checkDetail}>
                  {check.detail}
                </Text>
              ) : null}
              <Pill label={CHECK_PILLS[check.state].label} tone={CHECK_PILLS[check.state].tone} />
            </View>
          ))}
        </View>
      ) : null}
      {outcome !== 'open' ? <Text variant="meta">{`The PR was ${outcome}, so the ticket moved to Done.`}</Text> : null}
      {query.isError ? (
        <Text variant="meta" color={tone.danger.text} role="alert">
          {query.error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: space.lg,
    gap: space.md,
  },
  form: {
    gap: space.md,
  },
  submit: {
    alignSelf: 'flex-start',
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  spacer: {
    flex: 1,
  },
  checks: {
    gap: space.xs,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  checkName: {
    flexShrink: 0,
  },
  checkDetail: {
    flex: 1,
    minWidth: 0,
  },
});
