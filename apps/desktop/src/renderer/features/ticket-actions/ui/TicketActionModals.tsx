import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Lane, TicketAdoRef } from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { useWorkItemColors, type AdoOrgId } from '@/shared/api';
import { LANE_LABELS } from '@/shared/config';
import { toast } from '@/shared/model';
import { useMoveStage, useSetWorkItemState } from '../api/actions';
import { MOVE_TARGETS, descriptionText } from '../model/menu';
import { RadioList } from './RadioList';

/** View description (AL-270): the work item's description as text. */
export function ViewDescriptionModal({ visible, title, description, onClose, testID = 'ticket-description' }: { visible: boolean; title: string; description: string; onClose(): void; testID?: string }) {
  return (
    <Modal visible={visible} title="Description" subtitle={title} icon="file" width={640} onClose={onClose} footer={<Button label="Close" onPress={onClose} />} testID={`${testID}-modal`}>
      <ScrollView style={styles.descriptionScroll}>
        <Text variant="body" size="md" selectable testID={`${testID}-text`}>
          {descriptionText(description)}
        </Text>
      </ScrollView>
    </Modal>
  );
}

export interface ChangeStateModalProps {
  visible: boolean;
  ado: TicketAdoRef;
  /** The connection the work item is read through; left out for the first organisation. */
  org?: AdoOrgId;
  workItem: { type: string | null; state: string | null; title: string };
  onClose(): void;
  testID?: string;
}

/** Change ADO state… (AL-270): the type's states from the project's process, behind a confirm. */
export function ChangeStateModal({ visible, ado, org, workItem, onClose, testID = 'change-ado-state' }: ChangeStateModalProps) {
  return visible ? <ChangeStateDialog ado={ado} org={org} workItem={workItem} onClose={onClose} testID={testID} /> : null;
}

function ChangeStateDialog({ ado, org, workItem, onClose, testID }: Omit<ChangeStateModalProps, 'visible'> & { testID: string }) {
  const colors = useWorkItemColors({ ...(org ? { org } : {}), project: ado.project });
  const states = Object.keys(workItem.type ? (colors.data?.states[workItem.type] ?? {}) : {});
  const [state, setState] = useState<string | null>(null);
  const change = useSetWorkItemState();
  const chosen = state ?? workItem.state;
  const unchanged = chosen === workItem.state;
  const submit = () => {
    if (!chosen) return;
    change.mutate(
      { ...(org ? { org } : {}), project: ado.project, id: ado.workItemId, state: chosen },
      {
        onSuccess: (result) => {
          toast({ id: `ado-state:${ado.workItemId}`, tone: 'success', title: `#${ado.workItemId} is ${result.outcome === 'changed' ? result.state : chosen}`, body: result.outcome === 'changed' ? `Was ${result.previousState}.` : 'Azure DevOps already had it there.' });
          onClose();
        },
      },
    );
  };
  return (
    <Modal
      visible
      title={`Change the state of #${ado.workItemId}`}
      subtitle={workItem.title}
      icon="edit"
      width={480}
      onClose={change.isPending ? () => undefined : onClose}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label="Cancel" onPress={onClose} disabled={change.isPending} />
          <Button variant="primary" label={chosen ? `Set to ${chosen}` : 'Set state'} onPress={submit} disabled={!chosen || unchanged} loading={change.isPending} testID={`${testID}-confirm`} />
        </View>
      }
      testID={`${testID}-modal`}
    >
      <View style={styles.body}>
        <Text variant="body" size="sm" color={color.muted}>
          {workItem.state ? `Now ${workItem.state}. ` : ''}Azure DevOps is changed as soon as you confirm.
        </Text>
        {colors.isPending ? (
          <Text variant="meta">Reading the states…</Text>
        ) : states.length === 0 ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert">
            {workItem.type ? `No states are known for ${workItem.type}.` : 'The work item has not loaded yet.'}
          </Text>
        ) : (
          <RadioList<string> label="State" options={states.map((name) => ({ value: name, label: name }))} value={chosen} onChange={setState} disabled={change.isPending} testID={`${testID}-states`} />
        )}
        {change.error ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID={`${testID}-error`}>
            {change.error.message}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

export interface MoveStageModalProps {
  visible: boolean;
  ticketId: string;
  title: string;
  stage: Lane;
  onClose(): void;
  testID?: string;
}

/** Move to stage… (AL-270): any lane but Queued; the agent hears about it at its next turn. */
export function MoveStageModal({ visible, ticketId, title, stage, onClose, testID = 'move-stage' }: MoveStageModalProps) {
  return visible ? <MoveStageDialog ticketId={ticketId} title={title} stage={stage} onClose={onClose} testID={testID} /> : null;
}

function MoveStageDialog({ ticketId, title, stage, onClose, testID }: Omit<MoveStageModalProps, 'visible'> & { testID: string }) {
  const [target, setTarget] = useState<Exclude<Lane, 'queued'> | null>(stage === 'queued' ? null : stage);
  const move = useMoveStage(ticketId);
  const submit = () => {
    if (!target) return;
    move.mutate(target, {
      onSuccess: (result) => {
        toast({ id: `move-stage:${ticketId}`, tone: 'success', title: result.changed ? `Moved to ${LANE_LABELS[result.to]}` : `Already in ${LANE_LABELS[result.to]}`, body: result.changed ? 'The agent is told at its next turn.' : undefined });
        onClose();
      },
    });
  };
  return (
    <Modal
      visible
      title="Move to stage"
      subtitle={title}
      icon="branch"
      width={480}
      onClose={move.isPending ? () => undefined : onClose}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label="Cancel" onPress={onClose} disabled={move.isPending} />
          <Button variant="primary" label={target ? `Move to ${LANE_LABELS[target]}` : 'Move'} onPress={submit} disabled={!target || target === stage} loading={move.isPending} testID={`${testID}-confirm`} />
        </View>
      }
      testID={`${testID}-modal`}
    >
      <View style={styles.body}>
        <Text variant="body" size="sm" color={color.muted}>
          {`Now ${LANE_LABELS[stage]}. A gate waiting on the old stage is closed; a running agent carries on and is told where the ticket is now.`}
        </Text>
        <RadioList<Exclude<Lane, 'queued'>> label="Stage" options={MOVE_TARGETS.map((lane) => ({ value: lane, label: LANE_LABELS[lane] }))} value={target} onChange={setTarget} disabled={move.isPending} testID={`${testID}-lanes`} />
        {move.error ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID={`${testID}-error`}>
            {move.error.message}
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  descriptionScroll: {
    maxHeight: 480,
  },
});
