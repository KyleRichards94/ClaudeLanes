import { useMemo, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import type { BoardItemUpdate, TeamBoardItem, TeamBoardPerson } from '@agent-lanes/contracts';
import { space, tone } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { useTeamMembers, useUpdateBoardItem, useWorkItem, useWorkItemComments } from '@/shared/api';
import { toast } from '@/shared/model';
import { workItemText } from '../model/text';
import { ChoiceList } from './ChoiceList';

const UNASSIGNED = 'unassigned';

export interface BoardItemSheetProps {
  item: TeamBoardItem;
  /** The board's columns, in order: the card's status. */
  columns: readonly { id: string; name: string }[];
  teamId: string | null;
  onClose(): void;
}

/**
 * An open team-board card (AL-285): its description and acceptance criteria, and a person and a
 * status (the column it sits in). Saving writes both to Azure DevOps.
 */
export function BoardItemSheet({ item, columns, teamId, onClose }: BoardItemSheetProps) {
  const workItem = useWorkItem(item.id);
  const members = useTeamMembers(teamId, true);
  const update = useUpdateBoardItem();
  const [person, setPerson] = useState(personKey(item.assignee));
  const [columnId, setColumnId] = useState(item.columnId);

  const people = useMemo(() => peopleFor(item.assignee, members.data?.members ?? []), [item.assignee, members.data?.members]);
  const personChanged = person !== personKey(item.assignee);
  const columnChanged = columnId !== item.columnId;
  const chosen = people.find((candidate) => personKey(candidate) === person) ?? null;

  const submit = () => {
    if (!personChanged && !columnChanged) return;
    update.mutate(
      {
        ...(teamId ? { team: teamId } : {}),
        id: item.id,
        ...(personChanged ? { assignee: chosen ? { id: chosen.id, displayName: chosen.displayName, uniqueName: chosen.uniqueName } : null } : {}),
        ...(columnChanged ? { columnId } : {}),
      },
      {
        onSuccess: (result) => {
          toast({ id: `board-item:${item.id}`, tone: 'success', title: savedSummary(item.id, { person: personChanged, column: columnChanged }, result) });
          onClose();
        },
      },
    );
  };

  const description = workItem.data?.description ? workItemText(workItem.data.description) : '';
  const criteria = workItem.data?.acceptanceCriteria ? workItemText(workItem.data.acceptanceCriteria) : '';

  return (
    <Modal
      visible
      title={`#${item.id}`}
      subtitle={item.title}
      icon="file"
      iconTone="ado"
      width={720}
      onClose={update.isPending ? () => undefined : onClose}
      footer={
        <View style={styles.footer}>
          <Button label="Open in Azure DevOps" variant="soft" icon="arrow-up-right" onPress={() => void Linking.openURL(workItem.data?.webUrl ?? item.webUrl)} testID="board-item-open-ado" />
          <View style={styles.footerGap} />
          <Button variant="secondary" label="Cancel" onPress={onClose} disabled={update.isPending} testID="board-item-cancel" />
          <Button
            variant="primary"
            label="Save"
            onPress={submit}
            disabled={(!personChanged && !columnChanged) || (personChanged && person !== UNASSIGNED && !chosen)}
            loading={update.isPending}
            testID="board-item-save"
          />
        </View>
      }
      testID="board-item"
    >
      <View style={styles.body}>
        <Text variant="meta">
          {`${item.type} · ${workItem.data?.state ?? item.state}. Status is the column on this board. Saving writes the person and the column to Azure DevOps.`}
        </Text>
        <View style={styles.controls}>
          <ChoiceList
            label="Person"
            options={[{ value: UNASSIGNED, label: 'Unassigned' }, ...people.map((candidate) => ({ value: personKey(candidate), label: candidate.displayName }))]}
            value={person}
            onChange={setPerson}
            disabled={update.isPending}
            testID="board-item-person"
          />
          <ChoiceList
            label="Status"
            options={columns.map((column) => ({ value: column.id, label: column.name }))}
            value={columnId}
            onChange={setColumnId}
            disabled={update.isPending}
            testID="board-item-column"
          />
        </View>
        {members.isPending ? <Text variant="meta">Reading the team…</Text> : null}
        {members.isError ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert">
            {`Couldn't read the team. ${members.error.message}`}
          </Text>
        ) : null}
        <Section title="Description" testID="board-item-description">
          {workItem.isPending ? <Muted>Reading the work item…</Muted> : workItem.isError ? <Alert>{`Couldn't read it. ${workItem.error.message}`}</Alert> : description ? <Body>{description}</Body> : <Muted>No description.</Muted>}
        </Section>
        <Section title="Acceptance criteria" testID="board-item-criteria">
          {workItem.isPending ? null : workItem.isError ? null : criteria ? <Body>{criteria}</Body> : <Muted>No acceptance criteria.</Muted>}
        </Section>
        <Section title="Discussion" testID="board-item-comments">
          {workItem.data ? <Discussion id={item.id} project={workItem.data.project} /> : workItem.isPending ? <Muted>Reading the discussion…</Muted> : null}
        </Section>
        {update.error ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID="board-item-error">
            {update.error.message}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

function peopleFor(current: TeamBoardPerson | null, members: readonly TeamBoardPerson[]): TeamBoardPerson[] {
  const list = [...members];
  if (current && !list.some((candidate) => personKey(candidate) === personKey(current))) list.unshift(current);
  return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function personKey(person: Pick<TeamBoardPerson, 'id' | 'displayName'> | null): string {
  if (!person) return UNASSIGNED;
  return person.id ?? `name:${person.displayName}`;
}

function savedSummary(id: number, asked: { person: boolean; column: boolean }, result: BoardItemUpdate): string {
  const parts = [asked.person ? (result.assignee ? `assigned to ${result.assignee.displayName}` : 'unassigned') : null, asked.column ? (result.column ? `moved to ${result.column}` : 'left in its column') : null].filter(
    (part): part is string => part !== null,
  );
  return `#${id} ${parts.join(' and ')}`;
}

function Discussion({ id, project }: { id: number; project: string }) {
  const comments = useWorkItemComments(id, project);
  if (comments.isPending) return <Muted>Reading the discussion…</Muted>;
  if (comments.isError) return <Alert>{`Couldn't read the discussion. ${comments.error.message}`}</Alert>;
  if (!comments.data || comments.data.length === 0) return <Muted>No comments.</Muted>;
  return (
    <>
      {comments.data.map((comment) => (
        <View key={comment.id} style={styles.comment}>
          <Text variant="meta">{comment.author ?? 'Someone'}</Text>
          <Body>{workItemText(comment.text)}</Body>
        </View>
      ))}
    </>
  );
}

function Section({ title, testID, children }: { title: string; testID: string; children: ReactNode }) {
  return (
    <View style={styles.section} testID={testID}>
      <Text variant="title" size="sm" role="heading" aria-level={3}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Body({ children }: { children: string }) {
  return (
    <Text variant="body" selectable>
      {children}
    </Text>
  );
}

function Muted({ children }: { children: string }) {
  return (
    <Text variant="meta" size="md">
      {children}
    </Text>
  );
}

function Alert({ children }: { children: string }) {
  return (
    <Text variant="body" size="sm" color={tone.danger.text} role="alert">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  section: {
    gap: space.xs,
  },
  comment: {
    gap: 2,
    marginTop: space.xs,
  },
  footer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  footerGap: {
    flex: 1,
  },
});
