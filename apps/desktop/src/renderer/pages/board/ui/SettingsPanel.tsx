import { DROP_KINDS, DROP_KIND_LABELS, EFFORTS, MODELS, STAGES, type RepoSettings, type Settings } from '@agent-lanes/contracts';
import { useId, useMemo, useReducer, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, space } from '@agent-lanes/tokens';
import { Button, Modal, SegmentedControl, Switch, TabPanel, Tabs, Text, TextField } from '@agent-lanes/ui';
import { useAddRepo, useRemoveRepo, useRepoCommands, useSettings, useUpdateSettings } from '@/shared/api';
import { EFFORT_LABELS, MODEL_LABELS, stageLabel } from '@/shared/config';
import { toast } from '@/shared/model';
import {
  draftFromSettings,
  draftReducer,
  draftToPatch,
  dropErrorKey,
  isEmptyPatch,
  repoErrorKey,
  repoValues,
  validateDraft,
  type DraftAction,
  type DraftErrors,
  type SettingsDraft,
} from '../model/settings-draft';

export type SettingsSection = 'defaults' | 'drops' | 'repos';

export interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
  /** Opened from the Repo dropdown (AL-142): show this repo's settings first. */
  repoPath?: string | null;
  /** Which tab opens; `repos` when `repoPath` is given. */
  section?: SettingsSection;
}

/**
 * Settings (AL-146, design §10, R5): per repo the name, base branch, worktree folder, build and run
 * commands, agents at once and ADO write-back; for all tickets the default model, effort, stage
 * gates and skills, the build queue size and ADO state changes. Tokens and MCP servers are in
 * Connections; nothing is set in a file. Changes are kept in the form until Save settings.
 */
export function SettingsPanel({ visible, ...props }: SettingsPanelProps) {
  // Mounted only while open, so every opening starts from what is saved.
  return visible ? <OpenSettingsPanel {...props} /> : null;
}

function OpenSettingsPanel({ onClose, repoPath = null, section }: Omit<SettingsPanelProps, 'visible'>) {
  const settings = useSettings();
  const [tab, setTab] = useState<SettingsSection>(section ?? (repoPath ? 'repos' : 'defaults'));
  const idPrefix = useId();

  if (settings.data) {
    return <SettingsForm settings={settings.data} tab={tab} onTab={setTab} idPrefix={idPrefix} initialRepo={repoPath} onClose={onClose} />;
  }
  return (
    <Modal visible title={TITLE} subtitle={SUBTITLE} onClose={onClose} testID="settings-panel">
      <Text variant="meta" size="md">
        {settings.isError ? 'Settings could not be loaded.' : 'Loading settings…'}
      </Text>
    </Modal>
  );
}

interface SettingsFormProps {
  settings: Settings;
  tab: SettingsSection;
  onTab: (tab: SettingsSection) => void;
  idPrefix: string;
  initialRepo: string | null;
  onClose: () => void;
}

const TITLE = 'Settings';
const SUBTITLE = 'Repos and agent defaults. Tokens and MCP servers are in Connections.';

const TABS = [
  { value: 'defaults', label: 'Agent defaults' },
  { value: 'drops', label: 'Drops' },
  { value: 'repos', label: 'Repos' },
] as const;

function SettingsForm({ settings, tab, onTab, idPrefix, initialRepo, onClose }: SettingsFormProps) {
  const [draft, dispatch] = useReducer(draftReducer, settings, draftFromSettings);
  const update = useUpdateSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const errors = useMemo(() => validateDraft(draft, settings.repos), [draft, settings.repos]);
  const valid = Object.keys(errors).length === 0;
  const patch = useMemo(() => (valid ? draftToPatch(draft, settings) : null), [draft, settings, valid]);

  const save = () => {
    if (!patch || isEmptyPatch(patch)) return;
    setSaveError(null);
    update.mutate(patch, {
      onSuccess: () => {
        toast({ id: 'settings-saved', tone: 'success', title: 'Settings saved' });
        onClose();
      },
      onError: (cause) => setSaveError(cause instanceof Error ? cause.message : 'Settings could not be saved.'),
    });
  };

  const footer = (
    <>
      <Text variant="meta" size="sm" style={styles.note} color={saveError ? color.danger : undefined} role={saveError ? 'alert' : undefined}>
        {saveError ?? (valid ? 'Saved settings apply to new agent tickets and the next build.' : 'Fix the highlighted fields to save.')}
      </Text>
      <Button variant="secondary" label="Cancel" onPress={onClose} />
      <Button
        variant="primary"
        label="Save settings"
        onPress={save}
        loading={update.isPending}
        disabled={!patch || isEmptyPatch(patch)}
        testID="settings-save"
      />
    </>
  );

  return (
    <Modal visible title={TITLE} subtitle={SUBTITLE} onClose={onClose} footer={footer} testID="settings-panel">
      <View style={styles.form}>
        <Tabs tabs={TABS} value={tab} onChange={onTab} label="Settings sections" idPrefix={idPrefix} />
        <TabPanel idPrefix={idPrefix} value={tab}>
          {tab === 'defaults' ? (
            <DefaultsSection draft={draft} errors={errors} dispatch={dispatch} />
          ) : tab === 'drops' ? (
            <DropsSection draft={draft} errors={errors} dispatch={dispatch} />
          ) : (
            <ReposSection settings={settings} draft={draft} errors={errors} dispatch={dispatch} initialRepo={initialRepo} />
          )}
        </TabPanel>
      </View>
    </Modal>
  );
}

interface SectionProps {
  draft: SettingsDraft;
  errors: DraftErrors;
  dispatch: (action: DraftAction) => void;
}

const MODEL_OPTIONS = MODELS.map((model) => ({ value: model, label: MODEL_LABELS[model] }));
const EFFORT_OPTIONS = EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] }));

/**
 * Settings › Drops (AL-240, TB§3): the skills, model and effort each kind of team board drop starts its
 * agent with. Holding Alt while dropping changes them for one drop.
 */
function DropsSection({ draft, errors, dispatch }: SectionProps) {
  return (
    <View style={styles.section} testID="settings-drops">
      <Heading>Agents started by a drop on a lane</Heading>
      <Text variant="meta" size="sm">
        Hold Alt while you drop to change these for one drop.
      </Text>
      {DROP_KINDS.map((kind) => {
        const row = draft.drops[kind];
        const label = `${DROP_KIND_LABELS[kind].lane} · ${DROP_KIND_LABELS[kind].what}`;
        return (
          <View key={kind} style={styles.gates} testID={`settings-drop-${kind}`}>
            <Text variant="title" size="md" role="heading" aria-level={3}>
              {label}
            </Text>
            <TextField
              label={`${label}: skills`}
              value={row.skills}
              onChangeText={(skills) => dispatch({ type: 'drop', kind, change: { skills } })}
              placeholder="No skills"
              error={errors[dropErrorKey(kind)]}
              testID={`settings-drop-${kind}-skills`}
            />
            <SegmentedControl label={`${label}: model`} options={MODEL_OPTIONS} value={row.model} onChange={(model) => dispatch({ type: 'drop', kind, change: { model } })} fill />
            <SegmentedControl label={`${label}: effort`} options={EFFORT_OPTIONS} value={row.effort} onChange={(effort) => dispatch({ type: 'drop', kind, change: { effort } })} fill />
          </View>
        );
      })}
    </View>
  );
}

function DefaultsSection({ draft, errors, dispatch }: SectionProps) {
  return (
    <View style={styles.section}>
      <Heading>New agent tickets start with</Heading>
      <View style={styles.gates}>
        <Text variant="title" size="md" aria-hidden>
          Default model
        </Text>
        <SegmentedControl label="Default model" options={MODEL_OPTIONS} value={draft.model} onChange={(model) => dispatch({ type: 'model', model })} fill />
      </View>
      <View style={styles.gates}>
        <Text variant="title" size="md" aria-hidden>
          Default effort
        </Text>
        <SegmentedControl label="Default effort" options={EFFORT_OPTIONS} value={draft.effort} onChange={(effort) => dispatch({ type: 'effort', effort })} fill />
      </View>
      <View style={styles.gates}>
        <Text variant="title" size="md">
          Default stage gates
        </Text>
        {STAGES.map((stage) => (
          <Switch
            key={stage}
            label={stageLabel(stage)}
            value={draft.stageGates[stage] === 'approval'}
            stateText={{ on: 'Needs approval', off: 'Auto' }}
            onValueChange={(on) => dispatch({ type: 'gate', stage, gate: on ? 'approval' : 'auto' })}
          />
        ))}
      </View>
      <TextField
        label="Default skills"
        value={draft.skills}
        onChangeText={(value) => dispatch({ type: 'text', field: 'skills', value })}
        placeholder="/code-review /cs-qa-wip"
        help="Selected for you in New agent ticket. Separate skill names with spaces or commas."
        error={errors['skills']}
        testID="settings-skills"
      />

      <Heading>Builds and Azure DevOps</Heading>
      <TextField
        label="Builds at once"
        value={draft.buildQueueSize}
        onChangeText={(value) => dispatch({ type: 'text', field: 'buildQueueSize', value })}
        inputMode="numeric"
        help="Builds and runs across all worktrees; the rest wait in the queue."
        error={errors['buildQueueSize']}
        testID="settings-build-queue-size"
      />
      <Switch
        label="Move work items to the next state in Azure DevOps"
        value={draft.adoStateTransitions}
        stateText={{ on: 'On', off: 'Off' }}
        onValueChange={(value) => dispatch({ type: 'adoStateTransitions', value })}
      />

      {/* What headless agents do without asking (AL-109, D18); everything else shows "Needs you · permission". */}
      <Heading>Agent permissions</Heading>
      <Switch
        label="Edit files in the ticket's worktree without asking"
        value={draft.permissions.acceptEdits}
        stateText={{ on: 'On', off: 'Ask' }}
        onValueChange={(value) => dispatch({ type: 'permission', field: 'acceptEdits', value })}
      />
      <Switch
        label="Run git read commands (status, diff, log, show)"
        value={draft.permissions.gitRead}
        stateText={{ on: 'On', off: 'Ask' }}
        onValueChange={(value) => dispatch({ type: 'permission', field: 'gitRead', value })}
      />
      <Switch
        label="Run the repo's build and test commands"
        value={draft.permissions.buildAndTest}
        stateText={{ on: 'On', off: 'Ask' }}
        onValueChange={(value) => dispatch({ type: 'permission', field: 'buildAndTest', value })}
      />
      <TextField
        label="Other commands agents may run"
        value={draft.permissions.bashAllow}
        onChangeText={(value) => dispatch({ type: 'bashAllow', value })}
        placeholder="npm run lint, dotnet format"
        help="Commands starting with these run without asking. Separate them with commas. Anything else asks on the card."
        error={errors['bashAllow']}
        testID="settings-bash-allow"
      />
    </View>
  );
}

function ReposSection({ settings, draft, errors, dispatch, initialRepo }: SectionProps & { settings: Settings; initialRepo: string | null }) {
  const repos = settings.repos;
  const [chosen, setChosen] = useState<string | null>(initialRepo);
  const repo = repos.find((candidate) => candidate.path === chosen) ?? repos[0];
  const addRepo = useAddRepo();
  const removeRepo = useRemoveRepo();

  const add = () =>
    addRepo.mutate(undefined, {
      onSuccess: (outcome) => {
        if (outcome.status === 'added' || outcome.status === 'existing') setChosen(outcome.repo.path);
      },
    });

  return (
    <View style={styles.section}>
      <View style={styles.repoBar}>
        {repos.length > 0 && repo ? (
          <SegmentedControl
            label="Repo"
            tone="ink"
            options={repos.map((candidate) => ({ value: candidate.path, label: candidate.name, accessibilityLabel: `${candidate.name}, ${candidate.path}` }))}
            value={repo.path}
            onChange={setChosen}
            style={styles.repoPicker}
          />
        ) : (
          <Text variant="meta" size="md" style={styles.repoPicker}>
            No repos yet. Add the main checkout of a git repo to run agents in it.
          </Text>
        )}
        <Button variant="secondary" size="sm" icon="plus" label="Add repo…" onPress={add} loading={addRepo.isPending} />
      </View>
      {repo ? <RepoFields key={repo.path} repo={repo} draft={draft} errors={errors} dispatch={dispatch} onForget={() => removeRepo.mutate(repo.path)} /> : null}
    </View>
  );
}

function RepoFields({ repo, draft, errors, dispatch, onForget }: SectionProps & { repo: RepoSettings; onForget: () => void }) {
  const values = repoValues(draft, repo);
  const commands = useRepoCommands(repo.path);
  const detected = commands.data?.detected;
  const text = (field: Parameters<typeof repoErrorKey>[1]) => ({
    value: values[field],
    onChangeText: (value: string) => dispatch({ type: 'repoText', repo, field, value }),
    error: errors[repoErrorKey(repo, field)],
  });
  const detectedHelp = (command: string | null | undefined) =>
    commands.isPending ? 'Looking for build files…' : command ? `Leave empty to use the detected command: ${command}` : 'No command detected; enter one to use Build and Run.';

  return (
    <View style={styles.section} testID="settings-repo">
      <Text variant="mono" size="sm" color={color.muted} selectable>
        {repo.path}
      </Text>
      <View style={styles.pair}>
        <TextField label="Name" {...text('name')} style={styles.half} testID="settings-repo-name" />
        <TextField label="Base branch" {...text('baseBranch')} help="Tickets branch from it and merge back into it." style={styles.half} testID="settings-repo-base-branch" />
      </View>
      <TextField label="Worktree folder" {...text('worktreeRoot')} help="Each ticket gets its own worktree in this folder." testID="settings-repo-worktree-root" />
      <TextField
        label="Build command"
        {...text('buildCommand')}
        placeholder={detected?.build ?? undefined}
        help={detectedHelp(detected?.build)}
        testID="settings-repo-build-command"
      />
      <TextField
        label="Run command"
        {...text('runCommand')}
        placeholder={detected?.run ?? undefined}
        help={detectedHelp(detected?.run)}
        testID="settings-repo-run-command"
      />
      <TextField
        label="Agents at once"
        {...text('maxConcurrentAgents')}
        inputMode="numeric"
        help="More launches in this repo wait in Queued."
        testID="settings-repo-max-agents"
      />
      <Switch
        label="Post stage comments to Azure DevOps"
        value={values.adoWriteBack}
        stateText={{ on: 'On', off: 'Off' }}
        onValueChange={(value) => dispatch({ type: 'repoWriteBack', repo, value })}
      />
      <View style={styles.forget}>
        <Button variant="danger" size="sm" label="Forget this repo" onPress={onForget} />
        <Text variant="meta" size="sm" style={styles.note}>
          The folder and its worktrees stay on disk.
        </Text>
      </View>
    </View>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <Text variant="title" size="lg" role="heading" aria-level={3}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: space.lg,
  },
  section: {
    gap: space.lg,
    paddingTop: space.sm,
  },
  gates: {
    gap: space.xs,
  },
  repoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
  },
  repoPicker: {
    flexShrink: 1,
  },
  pair: {
    flexDirection: 'row',
    gap: space.lg,
  },
  half: {
    flex: 1,
  },
  forget: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  note: {
    flex: 1,
  },
});
