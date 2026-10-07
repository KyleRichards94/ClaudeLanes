import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { claudeConnectionStatusLine, type ClaudeAuthMode, type ClaudeConnectionSummary, type ConnectionId } from '@agent-lanes/contracts';
import { space, tone } from '@agent-lanes/tokens';
import { Button, SegmentedControl, Text, TextField } from '@agent-lanes/ui';
import { ConnectionForm, ConnectionRow, RemoveConnectionButton, TestOutcome, connectionStatusView } from '@/entities/connection';
import { useClaudeLoginDetection, useRemoveConnection, useTestConnection } from '@/shared/api';
import type { ClaudeDraft } from '../model/use-claude-draft';

const API_KEY_HELP = 'Sessions get it as ANTHROPIC_API_KEY. Create one in the Claude Console under Settings › API keys.';

interface ClaudeConnectionPanelProps {
  draft: ClaudeDraft;
  row: ClaudeConnectionSummary | undefined;
  /** The tab is showing: only then is Claude Code started to look for a login. */
  active: boolean;
  target: ConnectionId | null;
  request: number;
}

/** The Claude tab (AL-046, AL-044): the saved connection's row, or the form to connect one. */
export function ClaudeConnectionPanel({ draft, row, active, target, request }: ClaudeConnectionPanelProps) {
  const testSaved = useTestConnection();
  const removeConnection = useRemoveConnection();
  const showForm = !row || draft.replacing;
  // Looking starts Claude Code (no prompt is sent, D332), so only while the user is on this tab and could use it.
  const detection = useClaudeLoginDetection(active && showForm && draft.mode === 'login');
  const { startReplace, keyRef } = draft;

  useEffect(() => {
    if (target !== 'claude' || !row) return;
    startReplace();
    const timer = setTimeout(() => keyRef.current?.focus(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, target, row?.id]);

  const details = row
    ? row.status === 'error'
      ? row.mode === 'login'
        ? 'Claude Code login'
        : `API key${row.maskedToken ? ` ${row.maskedToken}` : ''}`
      : [claudeConnectionStatusLine(row), row.identity].filter(Boolean).join(' · ')
    : '';

  return (
    <View style={styles.panel} testID="connections-claude">
      {row ? (
        <ConnectionRow
          name="Claude"
          status={connectionStatusView(row)}
          details={details}
          problem={row.status === 'error' ? claudeConnectionStatusLine(row) : null}
          highlighted={draft.replacing}
          testID="connection-claude"
          actions={
            <>
              <Button label="Test" variant="secondary" size="sm" loading={testSaved.isPending} onPress={() => testSaved.mutate({ id: 'claude' })} testID="connection-claude-test" />
              <Button label="Replace" variant="secondary" size="sm" onPress={startReplace} testID="connection-claude-replace" />
              <RemoveConnectionButton name="Claude" busy={removeConnection.isPending} onRemove={() => removeConnection.mutate('claude')} testID="connection-claude-remove" />
            </>
          }
        />
      ) : null}

      {showForm ? (
        <ConnectionForm
          title={draft.replacing ? 'Change how Agent Lanes signs in to Claude' : 'Connect Claude'}
          aside={draft.replacing ? <Button label="Cancel replace" variant="secondary" size="sm" onPress={draft.cancelReplace} /> : undefined}
          testID="claude-draft"
        >
          <SegmentedControl<ClaudeAuthMode>
            label="Sign in with"
            tone="ink"
            value={draft.mode}
            onChange={draft.setMode}
            options={[
              { value: 'login', label: 'Use my Claude Code login' },
              { value: 'api-key', label: 'Use an API key' },
            ]}
            testID="claude-mode"
          />
          {draft.mode === 'login' ? (
            <View style={styles.login}>
              <View style={styles.detection} role="status" aria-live="polite" testID="claude-detection">
                {detection.isFetching ? (
                  <Text variant="meta" size="md">
                    Looking for a Claude Code login on this computer…
                  </Text>
                ) : detection.data?.found ? (
                  <Text variant="body">{`Found a Claude Code login: ${detection.data.identity ?? 'signed in'}`}</Text>
                ) : detection.data ? (
                  <Text variant="meta" size="md" color={tone.danger.text}>
                    {detection.data.message ?? 'No Claude Code login was found on this computer.'}
                  </Text>
                ) : detection.isError ? (
                  <Text variant="meta" size="md" color={tone.danger.text}>
                    {detection.error.message}
                  </Text>
                ) : null}
              </View>
              <View style={styles.buttons}>
                <Button label="Look again" variant="secondary" size="sm" disabled={detection.isFetching} onPress={() => void detection.refetch()} testID="claude-detect" />
                <Button
                  label="Test connection"
                  variant="secondary"
                  loading={draft.test.state === 'testing'}
                  disabled={!draft.canTest && draft.test.state !== 'testing'}
                  onPress={() => void draft.runTest()}
                  testID="claude-test-connection"
                />
              </View>
              <Text variant="meta">Agent Lanes never sees or stores your Claude Code login; sessions use it the way the terminal does.</Text>
            </View>
          ) : (
            <TextField
              ref={keyRef}
              variant="secure"
              label="API key"
              help={API_KEY_HELP}
              onSecretChange={draft.onKeyChange}
              onSubmitEditing={() => {
                if (draft.canTest) void draft.runTest();
              }}
              accessory={
                <Button
                  label="Test connection"
                  variant="secondary"
                  loading={draft.test.state === 'testing'}
                  disabled={!draft.canTest && draft.test.state !== 'testing'}
                  onPress={() => void draft.runTest()}
                  testID="claude-test-connection"
                />
              }
              testID="claude-api-key"
            />
          )}
          <TestOutcome
            test={draft.test}
            passedText={`Connection works${draft.test.result?.identity ? ` · ${draft.test.result.identity}` : ''}`}
            testID="claude-test-outcome"
          />
          {draft.saveError ? (
            <Text variant="meta" color={tone.danger.text} role="alert">
              {draft.saveError}
            </Text>
          ) : null}
        </ConnectionForm>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.lg,
  },
  login: {
    gap: space.md,
  },
  detection: {
    minHeight: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: space.sm,
  },
});
