import { Pressable, StyleSheet, View } from 'react-native';
import { color, minTarget, space, tone } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import type { AgentTicket } from '@/entities/agent-ticket';
import { useBuildRunActions } from '../api/build-run';
import { buildRunControls } from '../model/controls';

type TicketSlice = Pick<AgentTicket, 'id' | 'build' | 'run'>;

export interface BuildRunControlsProps {
  ticket: TicketSlice;
}

/**
 * The Worktree panel's body (artboard 3, R8): Build, Run (primary) and Stop on the ticket's own
 * worktree, then "Last build 14:02 · succeeded" and the run status. Available at every stage. The
 * buttons follow the queued / running / stopped state the events put in the agent ticket store.
 */
export function BuildRunControls({ ticket }: BuildRunControlsProps) {
  const actions = useBuildRunActions(ticket.id);
  const job = ticket.build.job;
  return (
    <BuildRunControlsView
      ticket={ticket}
      onBuild={() => actions.build.mutate()}
      onRun={() => actions.run.mutate()}
      onStop={(target) => {
        if (target === 'run') actions.stop.mutate();
        else if (job) actions.cancel.mutate(job.jobId);
      }}
      onOpen={() => actions.open.mutate()}
      pending={{
        build: actions.build.isPending,
        run: actions.run.isPending,
        stop: actions.stop.isPending || actions.cancel.isPending,
      }}
    />
  );
}

export interface BuildRunControlsViewProps {
  ticket: Pick<AgentTicket, 'build' | 'run'>;
  onBuild(): void;
  onRun(): void;
  /** Stops the run, or cancels the queued or running build job. */
  onStop(target: 'run' | 'job'): void;
  /** Opens the running web app's address. */
  onOpen(): void;
  /** Calls still in flight, so a second press does nothing before the first one's event arrives. */
  pending?: { build?: boolean; run?: boolean; stop?: boolean };
}

/** The panel body without its actions, for the component gallery's Worktree panel states. */
export function BuildRunControlsView({ ticket, onBuild, onRun, onStop, onOpen, pending = {} }: BuildRunControlsViewProps) {
  const view = buildRunControls(ticket);
  const stopTarget = view.stop.target;

  return (
    <View style={styles.body} testID="build-run">
      <View style={styles.buttons}>
        <Button
          label="Build"
          icon="build"
          onPress={onBuild}
          disabled={view.build.disabled && !view.build.loading}
          loading={view.build.loading || pending.build}
          style={styles.button}
          testID="build-run-build"
        />
        <Button
          variant="primary"
          label="Run"
          icon="play"
          onPress={onRun}
          disabled={view.run.disabled && !view.run.loading}
          loading={view.run.loading || pending.run}
          style={styles.button}
          testID="build-run-run"
        />
        <Button
          label="Stop"
          icon="stop"
          onPress={() => {
            if (stopTarget) onStop(stopTarget);
          }}
          disabled={stopTarget === null}
          loading={view.stop.loading || pending.stop}
          style={styles.button}
          testID="build-run-stop"
        />
      </View>
      <View style={styles.statusRow}>
        <Text variant="meta" size="md" color={view.buildFailed ? tone.danger.text : undefined} testID="build-run-build-status">
          {view.buildLine}
        </Text>
        {view.url ? (
          <Pressable role="link" aria-label={`Open ${view.url}`} onPress={onOpen} style={styles.link} testID="build-run-url">
            <Text variant="meta" size="md" color={color.ado} numberOfLines={1}>
              {view.runLine}
            </Text>
          </Pressable>
        ) : (
          <Text variant="meta" size="md" color={view.runFailed ? tone.danger.text : undefined} numberOfLines={1} testID="build-run-run-status">
            {view.runLine}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Read off artboard 3: three equal 44 px buttons 8 px apart, the status line under them. */
const styles = StyleSheet.create({
  body: {
    gap: space.md,
  },
  buttons: {
    flexDirection: 'row',
    gap: space.sm,
  },
  button: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.md,
  },
  // The address is a link: its target is 44 px tall like every control (design §11).
  link: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
});
