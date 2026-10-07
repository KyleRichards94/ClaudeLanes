import { EFFORTS, defaultAgentDefaults } from '@agent-lanes/contracts';
import { useReducer, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Modal, SegmentedControl, Text, TextField, type TextFieldHandle } from '@agent-lanes/ui';
import { useSettings } from '@/shared/api';
import { EFFORT_LABELS } from '@/shared/config';
import {
  initialForm,
  launchRequest,
  launchSummary,
  newTicketReducer,
  validateForm,
  type NewTicketErrors,
  type NewTicketRequest,
  type WorkItemSource,
} from '../model/form';
import { ModelPicker } from './ModelPicker';

export interface NewTicketModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Starts the agent (AL-165) with a valid request. The modal shows Launch as busy until it settles
   * and closes when it resolves; a rejection keeps the form open with the error under the summary.
   */
  onLaunch: (request: NewTicketRequest) => void | Promise<void>;
}

/**
 * New agent ticket (artboard 2): pick a work item or none, describe the job, choose how the agent
 * runs, then Launch. Every control is reachable with Tab and arrow keys, and Enter on "Launch agent"
 * launches, so the whole path works without a mouse (design §1: "under a minute").
 */
export function NewTicketModal({ visible, ...props }: NewTicketModalProps) {
  // Mounted only while open, so every opening starts from the saved defaults.
  return visible ? <OpenNewTicketModal {...props} /> : null;
}

const SOURCE_OPTIONS: readonly { value: WorkItemSource; label: string }[] = [
  // "Sprint 42" once the sprint list loads (AL-161).
  { value: 'sprint', label: 'Sprint' },
  { value: 'search', label: 'Search' },
  { value: 'none', label: 'No ticket' },
];
const EFFORT_OPTIONS = EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] }));

function OpenNewTicketModal({ onClose, onLaunch }: Omit<NewTicketModalProps, 'visible'>) {
  const settings = useSettings();
  const defaults = settings.data?.defaults ?? defaultAgentDefaults();
  const [form, dispatch] = useReducer(newTicketReducer, defaults, initialForm);
  // Settings usually load before the modal opens; if they arrive later, start again from them once.
  const [seeded, setSeeded] = useState(settings.data !== undefined);
  if (!seeded && settings.data) {
    setSeeded(true);
    dispatch({ type: 'reset', defaults: settings.data.defaults });
  }

  const [errors, setErrors] = useState<NewTicketErrors>({});
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const description = useRef<TextFieldHandle>(null);

  // Errors show after the first Launch, then follow the form as it is fixed.
  const shown = Object.keys(errors).length > 0 ? validateForm(form) : {};

  const launch = async () => {
    const result = launchRequest(form);
    if (!result.ok) {
      setErrors(result.errors);
      if (result.errors.description && !result.errors.workItem) description.current?.focus();
      return;
    }
    setErrors({});
    setLaunchError(null);
    setLaunching(true);
    try {
      await onLaunch(result.request);
      onClose();
    } catch (cause) {
      setLaunchError(cause instanceof Error ? cause.message : 'The agent could not be launched.');
      setLaunching(false);
    }
  };

  const footer = (
    <>
      <Text variant="meta" size="sm" style={styles.summary} color={launchError ? color.danger : undefined} role={launchError ? 'alert' : undefined}>
        {launchError ?? launchSummary(form)}
      </Text>
      <Button variant="secondary" label="Cancel" onPress={onClose} />
      <Button variant="primary" label="Launch agent" trailingIcon="arrow-right" onPress={() => void launch()} loading={launching} testID="launch-agent" />
    </>
  );

  return (
    <Modal
      visible
      title="New agent ticket"
      subtitle="Link a work item, describe the job, and pick how the agent runs."
      icon="plus"
      width={1040}
      padded={false}
      onClose={onClose}
      footer={footer}
      testID="new-ticket"
    >
      <View style={styles.columns}>
        <View style={styles.column} testID="new-ticket-left">
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text variant="title" size="md">
                Azure DevOps work item
              </Text>
              <Text variant="meta" size="sm">
                Optional
              </Text>
            </View>
            <SegmentedControl
              label="Azure DevOps work item"
              tone="ink"
              options={SOURCE_OPTIONS}
              value={form.source}
              onChange={(source) => dispatch({ type: 'source', source })}
              testID="work-item-source"
            />
            {form.source === 'none' ? (
              <Text variant="meta" size="sm">
                The agent works from your description. The worktree is named nt-… after it.
              </Text>
            ) : (
              // The sprint list and search results (AL-161) render here.
              <View style={styles.pickerSlot} testID="work-item-picker">
                <Text variant="meta" size="sm">
                  {form.workItem ? `#${form.workItem.id} ${form.workItem.title}` : 'Sprint work items appear here.'}
                </Text>
              </View>
            )}
            {shown.workItem ? (
              <View style={styles.error} role="alert">
                <Icon name="alert" size={14} color={color.danger} />
                <Text variant="body" size="sm" color={tone.danger.text}>
                  {shown.workItem}
                </Text>
              </View>
            ) : null}
          </View>
          <TextField
            ref={description}
            variant="multiline"
            label="What should the agent do?"
            value={form.description}
            onChangeText={(text) => dispatch({ type: 'description', description: text })}
            placeholder="Describe the job, what done looks like, and when to stop for you."
            rows={5}
            error={shown.description}
            testID="job-description"
          />
        </View>
        <View aria-hidden style={styles.divider} />
        <View style={styles.column} testID="new-ticket-right">
          <View style={styles.section}>
            <Text variant="title" size="md">
              Model
            </Text>
            <ModelPicker value={form.model} onChange={(model) => dispatch({ type: 'model', model })} />
          </View>
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text variant="title" size="md">
                Effort
              </Text>
              <Text variant="meta" size="sm">
                Changeable any time
              </Text>
            </View>
            <SegmentedControl label="Effort" options={EFFORT_OPTIONS} value={form.effort} onChange={(effort) => dispatch({ type: 'effort', effort })} fill />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Read off artboard 2: 26 px column padding, 24 px between sections, a full-height 1 px divider. */
const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  column: {
    flex: 1,
    gap: space.xl,
    paddingHorizontal: 26,
    paddingVertical: space.xl,
  },
  divider: {
    width: 1,
    backgroundColor: color.line,
  },
  section: {
    gap: space.md,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerSlot: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  summary: {
    flex: 1,
  },
});
