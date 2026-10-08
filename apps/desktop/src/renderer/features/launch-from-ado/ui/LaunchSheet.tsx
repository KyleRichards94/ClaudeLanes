import {
  EFFORTS,
  MODELS,
  STAGES,
  defaultAgentDefaults,
  dropDefaultsOf,
  dropKindOf,
  type Effort,
  type LaunchOverrides,
  type Model,
  type StageGates,
} from '@agent-lanes/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { Button, Modal, SegmentedControl, Switch, Text, TextField } from '@agent-lanes/ui';
import { useSettings } from '@/shared/api';
import { EFFORT_LABELS, MODEL_LABELS, stageLabel } from '@/shared/config';
import { closeLaunchSheet, useLaunchSheetRequest, type LaunchSheetRequest } from '../model/launch-sheet';

const MODEL_OPTIONS = MODELS.map((model) => ({ value: model, label: MODEL_LABELS[model] }));
const EFFORT_OPTIONS = EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] }));
const SKILL_NAME = /^[A-Za-z0-9][\w.:-]*$/;

/** "/code-review, pr-comment-actioner" → ["code-review", "pr-comment-actioner"], each once. */
export function parseSkillList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((name) => name.replace(/^\/+/, '')).filter(Boolean))];
}

/** Hosts the Alt launch sheet for the whole app (AL-240); mounted next to the other modal hosts. */
export function LaunchSheetHost() {
  const request = useLaunchSheetRequest();
  // Keyed by the drop, so each Alt drop starts from that lane's defaults.
  return request ? <LaunchSheet key={`${request.drop.source.kind}:${request.drop.source.id}:${request.drop.lane}`} request={request} /> : null;
}

/**
 * The Alt launch sheet (AL-240, TB§3): the lane's skills, model and effort from Settings › Drops, and
 * the stage gates, to change for this one drop before anything happens. "Start agent" launches with
 * them; Cancel, Esc or the close button changes nothing in Azure DevOps or on disk.
 */
export function LaunchSheet({ request }: { request: LaunchSheetRequest }) {
  const settings = useSettings();
  const { action, drop } = request;
  const defaults = dropDefaultsOf(settings.data ?? {})[dropKindOf(action)];
  const baseGates: StageGates = { ...(settings.data?.defaults.stageGates ?? defaultAgentDefaults().stageGates) };
  if (action.planGate !== null) baseGates.planning = action.planGate ? 'approval' : 'auto';

  const [skills, setSkills] = useState(defaults.skills.map((skill) => `/${skill}`).join(' '));
  const [model, setModel] = useState<Model>(defaults.model);
  const [effort, setEffort] = useState<Effort>(defaults.effort);
  const [gates, setGates] = useState<StageGates>(baseGates);
  const badSkill = parseSkillList(skills).find((name) => !SKILL_NAME.test(name));

  const what = drop.source.kind === 'pull-request' ? `!${drop.source.id}` : `#${drop.source.id}`;
  const start = () => {
    if (badSkill) return;
    const overrides: LaunchOverrides = { skills: parseSkillList(skills), model, effort, gates };
    closeLaunchSheet(overrides);
  };

  const footer = (
    <>
      <Text variant="meta" size="sm" style={styles.note}>
        {action.changesAdo ? 'Starting assigns the item to you and moves it to In Progress.' : 'Nothing changes in Azure DevOps.'}
      </Text>
      <Button variant="secondary" label="Cancel" onPress={() => closeLaunchSheet(null)} testID="launch-sheet-cancel" />
      <Button variant="primary" label="Start agent" trailingIcon="arrow-right" onPress={start} disabled={badSkill !== undefined} testID="launch-sheet-start" />
    </>
  );

  return (
    <Modal
      visible
      title={`${action.title} · ${what}`}
      subtitle={action.detail}
      icon="plus"
      width={560}
      onClose={() => closeLaunchSheet(null)}
      footer={footer}
      testID="launch-sheet"
    >
      <View style={styles.body}>
        <TextField
          label="Skills"
          value={skills}
          onChangeText={setSkills}
          placeholder="/code-review /pr-comment-actioner"
          help="Run in this order. Separate skill names with spaces or commas."
          error={badSkill ? `"${badSkill}" is not a skill name. Use names like /code-review.` : undefined}
          testID="launch-sheet-skills"
        />
        <View style={styles.group}>
          <Text variant="title" size="md" aria-hidden>
            Model
          </Text>
          <SegmentedControl label="Model" options={MODEL_OPTIONS} value={model} onChange={setModel} fill />
        </View>
        <View style={styles.group}>
          <Text variant="title" size="md" aria-hidden>
            Effort
          </Text>
          <SegmentedControl label="Effort" options={EFFORT_OPTIONS} value={effort} onChange={setEffort} fill />
        </View>
        <View style={styles.group}>
          <Text variant="title" size="md">
            Stage gates
          </Text>
          {STAGES.map((stage) => (
            <Switch
              key={stage}
              label={stageLabel(stage)}
              value={gates[stage] === 'approval'}
              stateText={{ on: 'Needs approval', off: 'Auto' }}
              onValueChange={(on) => setGates((current) => ({ ...current, [stage]: on ? 'approval' : 'auto' }))}
            />
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
  },
  group: {
    gap: space.sm,
  },
  note: {
    flex: 1,
  },
});
