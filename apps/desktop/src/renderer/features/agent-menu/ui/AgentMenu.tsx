import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AGENT_PERMISSION_MODES, agentPermissionMode, agentPermissionPolicy, type AgentPermissionMode, type AgentSessionState } from '@agent-lanes/contracts';
import { space } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { useCompactSession, useSessionStatus, useSettings, useStopSession, useTicketRecord } from '@/shared/api';
import { useSetPermissionMode } from '../api/permission-mode';
import { toast } from '@/shared/model';
import { ActionMenu, type ActionMenuItem } from '@/shared/ui';

export interface AgentMenuProps {
  ticketId: string;
  /** Items other features add above the session actions (Assign new agent, permission mode, stages, …). */
  extraItems?: readonly ActionMenuItem[];
  onExtraSelect?(key: string): void;
  testID?: string;
}

const LIVE: ReadonlySet<AgentSessionState> = new Set(['starting', 'running', 'idle', 'paused', 'queued']);

export const END_SESSION_KEY = 'end-session';
export const COMPACT_KEY = 'compact';
/** Permission mode items (AL-264): `mode:auto`, `mode:accept-edits`, `mode:ask`, and `mode:default` to follow Settings. */
export const PERMISSION_MODE_PREFIX = 'mode:';
const MODE_LABELS: Readonly<Record<AgentPermissionMode, string>> = { auto: 'Auto', 'accept-edits': 'Accept edits', ask: 'Ask' };
const MODE_DETAILS: Readonly<Record<AgentPermissionMode, string>> = {
  auto: 'Claude Code decides; only risky calls ask.',
  'accept-edits': 'Edits in the worktree go ahead; other tools ask.',
  ask: 'Every edit and tool call asks first.',
};

/**
 * The ticket's Agent ▾ menu (AL-253): End session, which closes the Claude Code process and keeps the
 * worktree and branch, behind a confirm. Later tickets add their items through `extraItems` (AL-263
 * Assign new agent, AL-264 permission mode, stages and Archive, AL-257 Compact).
 */
export function AgentMenu({ ticketId, extraItems = [], onExtraSelect, testID = 'agent-menu' }: AgentMenuProps) {
  const status = useSessionStatus(ticketId);
  const stop = useStopSession(ticketId);
  const compact = useCompactSession(ticketId);
  const record = useTicketRecord(ticketId).data ?? null;
  const settings = useSettings().data;
  const setMode = useSetPermissionMode(ticketId);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // The ticket's own mode (AL-264), or the Settings default it follows.
  const defaultMode = settings ? agentPermissionMode(agentPermissionPolicy(settings)) : 'auto';
  const override = record?.permissionMode ?? null;
  const modeItems: ActionMenuItem[] = [
    { key: `${PERMISSION_MODE_PREFIX}default`, label: `Follow Settings (${MODE_LABELS[defaultMode]})`, selected: override === null, section: 'Permission mode' },
    ...AGENT_PERMISSION_MODES.map((mode): ActionMenuItem => ({ key: `${PERMISSION_MODE_PREFIX}${mode}`, label: MODE_LABELS[mode], detail: MODE_DETAILS[mode], selected: override === mode, section: 'Permission mode' })),
  ];
  const live = status.data !== undefined && LIVE.has(status.data.state);
  const canCompact = status.data?.state === 'idle' || status.data?.state === 'running';

  const items: ActionMenuItem[] = [
    ...extraItems,
    ...modeItems,
    {
      key: COMPACT_KEY,
      label: 'Compact context',
      detail: canCompact ? 'Folds the conversation so far into a summary, freeing the context window.' : 'Needs a running or idle session.',
      icon: 'compact',
      disabled: !canCompact,
      section: 'Session',
    },
    {
      key: END_SESSION_KEY,
      label: 'End session',
      detail: live ? 'Closes the Claude Code process. The worktree and branch stay.' : 'No session is running.',
      icon: 'stop',
      danger: true,
      disabled: !live,
      section: 'Session',
    },
  ];

  const onSelect = (key: string) => {
    if (key.startsWith(PERMISSION_MODE_PREFIX)) {
      const picked = key.slice(PERMISSION_MODE_PREFIX.length);
      setMode.mutate(picked === 'default' ? null : (picked as AgentPermissionMode), {
        onSuccess: (result) => toast({ id: `permission-mode:${ticketId}`, tone: 'success', title: `Permission mode: ${MODE_LABELS[result.mode]}${result.override ? '' : ' (Settings)'}`, body: result.applied ? 'Applied to the running session.' : 'Applies from the next session.' }),
        onError: (error) => toast({ id: `permission-mode:${ticketId}`, tone: 'error', title: "Couldn't change the permission mode", body: error.message }),
      });
    } else if (key === END_SESSION_KEY) setConfirmEnd(true);
    else if (key === COMPACT_KEY) compact.mutate(undefined, { onError: (error) => toast({ id: `compact:${ticketId}`, tone: 'error', title: "Couldn't compact the context", body: error.message }) });
    else onExtraSelect?.(key);
  };

  const endSession = () =>
    stop.mutate(undefined, {
      onSuccess: () => setConfirmEnd(false),
      onError: (error) => toast({ id: `end-session:${ticketId}`, tone: 'error', title: "Couldn't end the session", body: error.message }),
    });

  return (
    <>
      <ActionMenu label="Agent" items={items} onSelect={onSelect} testID={testID} />
      <Modal
        visible={confirmEnd}
        title="End this session?"
        subtitle="The agent stops at once and its Claude Code process closes."
        icon="stop"
        onClose={() => setConfirmEnd(false)}
        width={440}
        footer={
          <View style={styles.footer}>
            <Button variant="secondary" label="Keep running" onPress={() => setConfirmEnd(false)} disabled={stop.isPending} />
            <Button variant="danger" label="End session" onPress={endSession} loading={stop.isPending} testID={`${testID}-confirm-end`} />
          </View>
        }
        testID={`${testID}-end-modal`}
      >
        <Text variant="body" size="md">
          The worktree, its branch and the ticket stay as they are. You can assign a new agent to carry on, or reconnect this one later from its saved session.
        </Text>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
});
