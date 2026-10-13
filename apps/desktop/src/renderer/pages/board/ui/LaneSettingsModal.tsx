import { DROP_KIND_LABELS, dropDefaultsOf, type DropKind, type Lane } from '@agent-lanes/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { useSettings, useUpdateSettings } from '@/shared/api';
import { LANE_LABELS } from '@/shared/config';
import { toast } from '@/shared/model';
import { laneDropKinds } from '../model/lane-drops';
import { dropDraftOf, dropRowErrors, dropRowOf, type DropDraft } from '../model/settings-draft';
import { DropRowFields } from './DropRowFields';

export interface LaneSettingsModalProps {
  lane: Lane;
  visible: boolean;
  onClose(): void;
}

/**
 * A lane's own Settings › Drops rows, from the settings button on its header: the skills, initial prompt,
 * model and effort of the agents a drop on this lane starts. Saving writes the same settings as the
 * Drops tab; they apply from the next drop.
 */
export function LaneSettingsModal({ lane, visible, onClose }: LaneSettingsModalProps) {
  const settings = useSettings();
  // Mounted only while open, so the rows are read fresh from the saved settings each time.
  return visible && settings.data ? <LaneSettingsForm lane={lane} saved={settings.data} onClose={onClose} /> : null;
}

function LaneSettingsForm({ lane, saved, onClose }: { lane: Lane; saved: Parameters<typeof dropDefaultsOf>[0]; onClose(): void }) {
  const kinds = laneDropKinds(lane);
  const update = useUpdateSettings();
  const [rows, setRows] = useState<Partial<Record<DropKind, DropDraft>>>(() => {
    const defaults = dropDefaultsOf(saved);
    return Object.fromEntries(kinds.map((kind) => [kind, dropDraftOf(defaults[kind])]));
  });
  const errors = Object.fromEntries(kinds.map((kind) => [kind, dropRowErrors(rows[kind]!)])) as Record<DropKind, ReturnType<typeof dropRowErrors>>;
  const invalid = kinds.some((kind) => errors[kind].skills || errors[kind].prompt);
  const name = LANE_LABELS[lane];

  const save = () => {
    const dropDefaults = dropDefaultsOf(saved);
    for (const kind of kinds) dropDefaults[kind] = dropRowOf(rows[kind]!);
    update.mutate(
      { dropDefaults },
      {
        onSuccess: () => {
          toast({ id: `lane-settings:${lane}`, tone: 'success', title: `${name} settings saved`, body: 'They apply from the next drop on this lane.' });
          onClose();
        },
        onError: (error) => toast({ id: `lane-settings:${lane}`, tone: 'warning', title: `Couldn't save ${name} settings`, body: error.message }),
      },
    );
  };

  return (
    <Modal
      visible
      title={`${name} settings`}
      subtitle="Skills and the initial prompt for agents a drop on this lane starts."
      icon="edit"
      width={620}
      onClose={onClose}
      testID={`lane-settings-${lane}`}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          <Button label="Save" variant="strong" disabled={invalid} loading={update.isPending} onPress={save} testID={`lane-settings-${lane}-save`} />
        </>
      }
    >
      <View style={styles.body}>
        {kinds.length > 1 ? (
          <Text variant="meta" size="sm">
            This lane starts different agents for an item and for your PR with comments.
          </Text>
        ) : null}
        {kinds.map((kind) => (
          <DropRowFields
            key={kind}
            label={`${DROP_KIND_LABELS[kind].lane} · ${DROP_KIND_LABELS[kind].what}`}
            row={rows[kind]!}
            onChange={(change) => setRows((current) => ({ ...current, [kind]: { ...current[kind]!, ...change } }))}
            errors={errors[kind]}
            testID={`lane-settings-${lane}-${kind}`}
          />
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
  },
});
