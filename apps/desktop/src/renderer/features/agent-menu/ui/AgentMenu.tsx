import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AgentSessionState } from '@agent-lanes/contracts';
import { space } from '@agent-lanes/tokens';
import { Button, Modal, Text } from '@agent-lanes/ui';
import { useSessionStatus, useStopSession } from '@/shared/api';
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

/**
 * The ticket's Agent ▾ menu (AL-253): End session, which closes the Claude Code process and keeps the
 * worktree and branch, behind a confirm. Later tickets add their items through `extraItems` (AL-263
 * Assign new agent, AL-264 permission mode, stages and Archive, AL-257 Compact).
 */
export function AgentMenu({ ticketId, extraItems = [], onExtraSelect, testID = 'agent-menu' }: AgentMenuProps) {
  const status = useSessionStatus(ticketId);
  const stop = useStopSession(ticketId);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const live = status.data !== undefined && LIVE.has(status.data.state);

  const items: ActionMenuItem[] = [
    ...extraItems,
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
    if (key === END_SESSION_KEY) setConfirmEnd(true);
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
