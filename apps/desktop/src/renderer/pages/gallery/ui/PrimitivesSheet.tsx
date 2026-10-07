import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import {
  Badge,
  Button,
  Card,
  GlassPanel,
  Icon,
  IconProvider,
  IdChip,
  Modal,
  Pill,
  ProgressBar,
  SegmentedControl,
  StatusBadge,
  Switch,
  TabPanel,
  Tabs,
  Text,
  TextField,
  Toast,
  badgeStatuses,
  buttonSizes,
  buttonVariants,
  iconNames,
  pillTones,
  textVariants,
  toastTones,
  type TabItem,
} from '@agent-lanes/ui';
import { WorkItemChip } from '@/entities/ado-work-item';
import { GalleryBlock, GalleryRow, GallerySheet } from './GallerySection';

/** One work item per state category, for the WorkItemChip samples (AL-066). */
const workItemSamples = [
  { id: 71273, title: 'Cutover frmJobControl to Blazor', type: 'User Story', state: 'Active', stateCategory: 'in-progress' },
  { id: 71330, title: 'Job filter keeps its state', type: 'Bug', state: 'New', stateCategory: 'proposed' },
  { id: 71335, title: 'Grid paging in the job list', type: 'Task', state: 'Resolved', stateCategory: 'resolved' },
  { id: 71341, title: 'Remove the legacy job form', type: 'User Story', state: 'Closed', stateCategory: 'completed' },
] as const;

const variantSamples: Record<(typeof textVariants)[number], string> = {
  display: 'Agent board',
  title: 'Cutover frmJobControl to Blazor',
  body: 'What should the agent do?',
  meta: 'Story · Active · Sprint 42',
  mono: '71273-cutover-job-control',
};

type WorkItemSource = 'sprint' | 'search' | 'none';
type Effort = 'low' | 'med' | 'high' | 'xhigh' | 'max';
type ConnectionTab = 'ado' | 'claude' | 'mcp';
type DrillInTab = 'output' | 'diff' | 'build' | 'ado' | 'design';

const connectionTabs: readonly TabItem<ConnectionTab>[] = [
  { value: 'ado', label: 'Azure DevOps', status: { tone: 'attention', label: 'Needs attention' } },
  { value: 'claude', label: 'Claude', status: { tone: 'ok', label: 'Connected' } },
  { value: 'mcp', label: 'MCP servers', status: { tone: 'ok', label: 'Connected' } },
];

const drillInTabs: readonly TabItem<DrillInTab>[] = [
  { value: 'output', label: 'Output' },
  { value: 'diff', label: 'Diff' },
  { value: 'build', label: 'Build log' },
  { value: 'ado', label: 'ADO' },
  { value: 'design', label: 'Claude Design', opensElsewhere: true },
];

/** Every primitive in `packages/ui`, in its variants and states (design §11 Primitives). */
export function PrimitivesSheet() {
  const [source, setSource] = useState<WorkItemSource>('sprint');
  const [effort, setEffort] = useState<Effort>('xhigh');
  const [planningGate, setPlanningGate] = useState(true);
  const [codeReviewGate, setCodeReviewGate] = useState(false);
  const [connectionTab, setConnectionTab] = useState<ConnectionTab>('ado');
  const [drillInTab, setDrillInTab] = useState<DrillInTab>('output');
  const [modal, setModal] = useState<'none' | 'normal' | 'blocking'>('none');
  const [jobDescription, setJobDescription] = useState('');

  return (
    <GallerySheet kicker="packages/ui" title="Primitives" testID="gallery-primitives">
      <GalleryBlock title="Text" rule>
        {textVariants.map((variant) => (
          <View key={variant} style={styles.labelled}>
            <Text variant="mono" size="xs" color={color.muted} style={styles.label}>
              {variant}
            </Text>
            <Text variant={variant}>{variantSamples[variant]}</Text>
          </View>
        ))}
      </GalleryBlock>

      <GalleryBlock title="Button" rule>
        {buttonSizes.map((size) => (
          <GalleryRow key={size}>
            <Text variant="mono" size="xs" color={color.muted} style={styles.label}>
              {size}
            </Text>
            {buttonVariants.map((variant) => (
              <Button key={variant} label={variant === 'danger' ? 'Remove' : variant[0]?.toUpperCase() + variant.slice(1)} variant={variant} size={size} />
            ))}
          </GalleryRow>
        ))}
        <GalleryRow>
          <Text variant="mono" size="xs" color={color.muted} style={styles.label}>
            states
          </Text>
          <Button label="New agent ticket" variant="primary" icon="plus" />
          <Button label="Launch agent" variant="primary" trailingIcon="arrow-right" />
          <Button label="Testing" variant="secondary" loading />
          <Button label="Save connections" variant="primary" disabled />
          <Button label="Connections" icon="link" iconOnly />
          <Button label="Stop" variant="secondary" icon="stop" size="sm" />
        </GalleryRow>
      </GalleryBlock>

      <GalleryBlock title="Pill, Badge, StatusBadge, IdChip" rule>
        <GalleryRow>
          {pillTones.map((pillTone) => (
            <Pill key={pillTone} tone={pillTone} label={pillTone} />
          ))}
        </GalleryRow>
        <GalleryRow>
          <Pill tone="claude" dot size="md" label="4 running" />
          <Pill tone="attention" dot size="md" label="2 need you" />
          <Pill tone="neutral" dot size="md" label="1 queued" />
          <Pill tone="ok" dot size="md" label="MCP online" />
          <Pill tone="ok" label="Connected" />
        </GalleryRow>
        <GalleryRow>
          <Badge count={3} />
          <Badge count={2} tone="attention" />
          {badgeStatuses.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
          <IdChip id={71273} />
          <IdChip id="#71330" />
        </GalleryRow>
      </GalleryBlock>

      <GalleryBlock title="SegmentedControl and Switch" rule>
        <GalleryRow>
          <SegmentedControl
            label="Work item"
            tone="ink"
            value={source}
            onChange={setSource}
            options={[
              { value: 'sprint', label: 'Sprint 42' },
              { value: 'search', label: 'Search' },
              { value: 'none', label: 'No ticket' },
            ]}
          />
          <SegmentedControl
            label="Effort"
            value={effort}
            onChange={setEffort}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'med', label: 'Med', accessibilityLabel: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'xhigh', label: 'XHigh', accessibilityLabel: 'Extra high' },
              { value: 'max', label: 'Max' },
            ]}
          />
          <SegmentedControl
            label="Effort pills"
            variant="pills"
            value={effort}
            onChange={setEffort}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'med', label: 'Med', accessibilityLabel: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'xhigh', label: 'XHigh', accessibilityLabel: 'Extra high' },
              { value: 'max', label: 'Max' },
            ]}
          />
        </GalleryRow>
        <View style={styles.switches}>
          <Switch label="Planning" value={planningGate} onValueChange={setPlanningGate} stateText={{ on: 'Needs approval', off: 'Auto' }} />
          <Switch label="Code review" value={codeReviewGate} onValueChange={setCodeReviewGate} stateText={{ on: 'Needs approval', off: 'Auto' }} />
          <Switch label="Create PR" value onValueChange={() => undefined} stateText={{ on: 'Needs approval', off: 'Auto' }} disabled />
        </View>
      </GalleryBlock>

      <GalleryBlock title="TextField" rule>
        <View style={styles.fields}>
          <TextField label="Organisation URL" placeholder="https://dev.azure.com/your-org" style={styles.field} />
          <TextField label="Default project" placeholder="Loaded after the token is tested" disabled style={styles.field} />
          <TextField
            variant="secure"
            label="Personal access token"
            help="Needs Work Items (read & write), Code (read & write) and Build (read)."
            accessory={<Button label="Test connection" variant="secondary" />}
            style={styles.wideField}
          />
          <TextField variant="search" aria-label="Search work items" placeholder="Search by ID or title" style={styles.field} />
          <TextField label="Organisation URL (error)" defaultValue="dev.azure" error="Enter the full URL, like https://dev.azure.com/contoso" style={styles.field} />
          <TextField variant="multiline" label="What should the agent do?" value={jobDescription} onChangeText={setJobDescription} rows={3} style={styles.wideField} />
        </View>
      </GalleryBlock>

      <GalleryBlock title="Card, ProgressBar, GlassPanel" rule>
        <GalleryRow style={styles.top}>
          <Card style={styles.plainCard}>
            <View style={styles.cardBody}>
              <Text variant="title">Card</Text>
              <Text variant="meta">Surface, radius 16, card shadow</Text>
            </View>
          </Card>
          <View style={styles.bars}>
            <ProgressBar progress={0.46} label="Claude progress" />
            <ProgressBar progress={0.94} tone="ado" label="ADO progress" />
            <ProgressBar progress={0.46} tone="danger" label="Failed progress" />
            <ProgressBar progress={1} tone="ok" label="Merged progress" />
          </View>
          <GlassPanel style={styles.glassSample}>
            <Text variant="title">GlassPanel</Text>
            <Text variant="meta">md · 18px blur</Text>
          </GlassPanel>
        </GalleryRow>
      </GalleryBlock>

      <GalleryBlock title="Icon" rule>
        {/* IconProvider sets the colour and size icons inherit (here the Claude violet at 20 px). */}
        <IconProvider color={color.claude} size={20}>
          <GalleryRow>
            {iconNames.map((name) => (
              <View key={name} style={styles.iconSample}>
                <Icon name={name} />
                <Text variant="mono" size="xs" color={color.muted}>
                  {name}
                </Text>
              </View>
            ))}
          </GalleryRow>
        </IconProvider>
      </GalleryBlock>

      <GalleryBlock title="Tabs" rule>
        <Tabs label="Connection type" tabs={connectionTabs} value={connectionTab} onChange={setConnectionTab} idPrefix="gallery-connections" />
        <TabPanel idPrefix="gallery-connections" value={connectionTab}>
          <Text variant="meta">{`Showing the ${connectionTab} tab.`}</Text>
        </TabPanel>
        <Tabs label="Ticket views" tabs={drillInTabs} value={drillInTab} onChange={setDrillInTab} idPrefix="gallery-drill-in" />
        <TabPanel idPrefix="gallery-drill-in" value={drillInTab}>
          <Text variant="meta">{`Showing the ${drillInTab} tab.`}</Text>
        </TabPanel>
      </GalleryBlock>

      <GalleryBlock title="WorkItemChip (entities/ado-work-item)" rule>
        {workItemSamples.map((item) => (
          <WorkItemChip key={item.id} item={item} testID={`gallery-work-item-${item.id}`} />
        ))}
      </GalleryBlock>

      <GalleryBlock title="Toast" rule>
        <GalleryRow style={styles.top}>
          {toastTones.map((toastTone) => (
            <Toast
              key={toastTone}
              tone={toastTone}
              title={`${toastTone[0]?.toUpperCase()}${toastTone.slice(1)} notice`}
              body="One or two sentences of detail."
              actions={toastTone === 'error' ? [{ label: 'Reconnect', onPress: () => undefined }] : []}
              onDismiss={toastTone === 'info' ? undefined : () => undefined}
            />
          ))}
        </GalleryRow>
      </GalleryBlock>

      <GalleryBlock title="Modal" rule>
        <GalleryRow>
          <Button label="Open modal" variant="secondary" onPress={() => setModal('normal')} testID="gallery-open-modal" />
          <Button label="Open blocking modal" variant="secondary" onPress={() => setModal('blocking')} testID="gallery-open-blocking-modal" />
        </GalleryRow>
        <Modal
          visible={modal === 'normal'}
          title="Connections"
          subtitle="Tokens are encrypted on this computer and never shown again after you save them."
          icon="link"
          iconTone="ado"
          onClose={() => setModal('none')}
          footer={<Button label="Done" variant="primary" onPress={() => setModal('none')} />}
          testID="gallery-modal"
        >
          <Text variant="body">Esc or the close button closes this modal.</Text>
        </Modal>
        <Modal
          visible={modal === 'blocking'}
          blocking
          title="Connect Agent Lanes"
          subtitle="A blocking modal has no close button and ignores Esc."
          icon="lock"
          footer={<Button label="Finish" variant="primary" onPress={() => setModal('none')} />}
          testID="gallery-blocking-modal"
        >
          <Text variant="body">Only its own actions close it, as first-run Connections does.</Text>
        </Modal>
      </GalleryBlock>
    </GallerySheet>
  );
}

const styles = StyleSheet.create({
  labelled: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.md,
  },
  label: {
    width: 64,
  },
  switches: {
    width: 420,
    gap: space.xs,
  },
  fields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  field: {
    width: 360,
  },
  wideField: {
    width: 736,
  },
  top: {
    alignItems: 'flex-start',
  },
  plainCard: {
    width: 260,
  },
  cardBody: {
    padding: 14,
    gap: space.xs,
  },
  bars: {
    width: 260,
    gap: space.md,
    paddingTop: space.sm,
  },
  glassSample: {
    width: 260,
    padding: space.lg,
    gap: space.xs,
    borderRadius: radius.panel,
  },
  iconSample: {
    width: 104,
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
  },
});
