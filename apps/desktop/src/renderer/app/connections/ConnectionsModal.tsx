import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AdoConnectionSummary, ClaudeConnectionSummary, ConnectionKind, McpConnectionSummary } from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Modal, TabPanel, Tabs, Text, type TabItem } from '@agent-lanes/ui';
import { connectionTabStatus, type ConnectionDraftController } from '@/entities/connection';
import { AdoConnectionsPanel, useAdoDraft } from '@/features/ado-organisations';
import { ClaudeConnectionPanel, useClaudeDraft } from '@/features/claude-sign-in';
import { McpServersPanel, useMcpDraft } from '@/features/mcp-servers';
import { useConnections } from '@/shared/api';
import { closeConnections, showConnectionsTab, useConnectionsModal } from '@/shared/model';

export const CONNECTIONS_SUBTITLE = 'Tokens are encrypted on this computer and never shown again after you save them.';
export const CONNECTIONS_LOCK_NOTE = "Stored with your operating system's keychain. Agents receive tokens at launch; the interface never does.";

const tabLabels: Record<ConnectionKind, string> = { ado: 'Azure DevOps', claude: 'Claude', mcp: 'MCP servers' };

/**
 * Whether Save connections can run (AL-046): at least one draft row has passed Test connection, and
 * no other row holds edits that haven't (they would be lost or saved untested).
 */
export function canSaveDrafts(drafts: readonly Pick<ConnectionDraftController, 'status'>[]): boolean {
  return drafts.some((draft) => draft.status === 'passed') && !drafts.some((draft) => draft.status === 'untested');
}

/**
 * The Connections modal (AL-046, design §8, artboard 5, R4), composed from the three connect
 * features. It is the only place tokens are typed. It opens from the board header, from a toast's
 * Reconnect (landing on that row with its token field focused) and blocking on first run (AL-047).
 */
export function ConnectionsModal() {
  const open = useConnectionsModal((state) => state.open);
  const blocking = useConnectionsModal((state) => state.blocking);
  const tab = useConnectionsModal((state) => state.tab);
  const target = useConnectionsModal((state) => state.target);
  const request = useConnectionsModal((state) => state.request);
  const connections = useConnections();
  const ado = useAdoDraft();
  const claude = useClaudeDraft();
  const mcp = useMcpDraft();
  const idPrefix = useId();
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = connections.data ?? [];
  const adoRows = rows.filter((row): row is AdoConnectionSummary => row.kind === 'ado');
  const claudeRow = rows.find((row): row is ClaudeConnectionSummary => row.kind === 'claude');
  const mcpRows = rows.filter((row): row is McpConnectionSummary => row.kind === 'mcp');

  const drafts = [ado, claude, mcp];
  const canSave = canSaveDrafts(drafts);
  const saving = drafts.some((draft) => draft.saving);

  const tabs: TabItem<ConnectionKind>[] = (['ado', 'claude', 'mcp'] as const).map((kind) => ({
    value: kind,
    label: tabLabels[kind],
    status: connectionTabStatus(rows, kind),
  }));

  // A reconnect target focuses its own token field; otherwise the modal's first control takes focus.
  const initialFocusRef = target === 'claude' ? claude.keyRef : target?.startsWith('mcp:') ? mcp.tokenRef : target ? ado.patRef : undefined;

  function close() {
    for (const draft of drafts) draft.clear();
    setSaveError(null);
    closeConnections();
  }

  async function save() {
    setSaveError(null);
    try {
      for (const draft of drafts) if (draft.status === 'passed') await draft.save();
    } catch {
      setSaveError('Not everything was saved. The rows above say what went wrong.');
      return;
    }
    if (!blocking) closeConnections();
  }

  const footer = (
    <>
      <View style={styles.note}>
        <Icon name="lock" size={14} color={color.muted} />
        <Text variant="meta" style={styles.noteText}>
          {CONNECTIONS_LOCK_NOTE}
        </Text>
      </View>
      {saveError ? (
        <Text variant="meta" color={tone.danger.text} role="alert" style={styles.saveError}>
          {saveError}
        </Text>
      ) : null}
      {blocking ? null : <Button label="Cancel" variant="secondary" onPress={close} testID="connections-cancel" />}
      <Button
        label="Save connections"
        variant="primary"
        disabled={!canSave}
        loading={saving}
        onPress={() => void save()}
        testID="connections-save"
      />
    </>
  );

  const content = (
    <View style={styles.body}>
      <Tabs label="Connection type" tabs={tabs} value={tab} onChange={showConnectionsTab} idPrefix={idPrefix} testID="connections-tabs" style={styles.tabs} />
      {connections.isError ? (
        <Text variant="meta" color={tone.danger.text} role="alert">
          {`Saved connections could not be loaded: ${connections.error.message}`}
        </Text>
      ) : null}
      {/* Every panel stays mounted so a half-typed draft survives a tab switch; only the selected one shows. */}
      <TabPanel idPrefix={idPrefix} value="ado" style={tab === 'ado' ? undefined : styles.hidden}>
        <AdoConnectionsPanel draft={ado} rows={adoRows} target={tab === 'ado' ? target : null} request={request} />
      </TabPanel>
      <TabPanel idPrefix={idPrefix} value="claude" style={tab === 'claude' ? undefined : styles.hidden}>
        <ClaudeConnectionPanel draft={claude} row={claudeRow} active={open && tab === 'claude'} target={tab === 'claude' ? target : null} request={request} />
      </TabPanel>
      <TabPanel idPrefix={idPrefix} value="mcp" style={tab === 'mcp' ? undefined : styles.hidden}>
        <McpServersPanel draft={mcp} rows={mcpRows} allRows={rows} target={tab === 'mcp' ? target : null} request={request} />
      </TabPanel>
    </View>
  );

  const common = {
    visible: open,
    title: 'Connections',
    subtitle: CONNECTIONS_SUBTITLE,
    icon: 'link' as const,
    iconTone: 'ado' as const,
    footer,
    initialFocusRef,
    testID: 'connections-modal',
  };

  return blocking ? (
    <Modal {...common} blocking>
      {content}
    </Modal>
  ) : (
    <Modal {...common} onClose={close}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
  },
  tabs: {
    alignSelf: 'flex-start',
  },
  hidden: {
    display: 'none',
  },
  note: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  noteText: {
    flexShrink: 1,
  },
  saveError: {
    maxWidth: 240,
  },
});
