import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ConnectionId, ConnectionSummary, McpConnectionSummary } from '@agent-lanes/contracts';
import { space, tone } from '@agent-lanes/tokens';
import { Button, SegmentedControl, Text, TextField } from '@agent-lanes/ui';
import { ConnectionForm, ConnectionRow, RemoveConnectionButton, TestOutcome, connectionStatusView } from '@/entities/connection';
import { useRemoveConnection, useTestConnection } from '@/shared/api';
import { joinArgs, type McpDraft, type McpTransportType } from '../model/use-mcp-draft';

/** How a server is reached, in one line: `npx -y @azure-devops/mcp contoso` or `HTTP · https://…`. */
export function describeMcpTransport(row: McpConnectionSummary): string {
  const { transport } = row;
  return transport.type === 'stdio'
    ? [transport.command, joinArgs(transport.args)].filter(Boolean).join(' ')
    : `${transport.type.toUpperCase()} · ${transport.url}`;
}

/** The row's detail line: how it is reached, how many tools its last test found, and what token it uses. */
export function mcpRowDetails(row: McpConnectionSummary, rows: readonly ConnectionSummary[]): string {
  const org = row.builtInFor ? rows.find((other) => other.id === row.builtInFor) : undefined;
  return [
    describeMcpTransport(row),
    row.tools ? `${row.tools.length} ${row.tools.length === 1 ? 'tool' : 'tools'}` : null,
    row.builtInFor ? `built in · uses ${org?.name ?? row.builtInFor}'s token` : row.maskedToken ? `token ${row.maskedToken}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

interface McpServersPanelProps {
  draft: McpDraft;
  rows: readonly McpConnectionSummary[];
  /** Every connection, to name the organisation a built-in server belongs to. */
  allRows: readonly ConnectionSummary[];
  target: ConnectionId | null;
  request: number;
}

/** The MCP servers tab (AL-046, AL-045): saved servers with their test output, then the draft row. */
export function McpServersPanel({ draft, rows, allRows, target, request }: McpServersPanelProps) {
  const testSaved = useTestConnection();
  const removeConnection = useRemoveConnection();
  const [testingId, setTestingId] = useState<ConnectionId | null>(null);
  const targetRow = rows.find((row) => row.id === target && !row.builtInFor);
  const { startReplace, tokenRef } = draft;

  useEffect(() => {
    if (!targetRow) return;
    startReplace(targetRow);
    const timer = setTimeout(() => tokenRef.current?.focus(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, targetRow?.id]);

  function retest(id: ConnectionId) {
    setTestingId(id);
    testSaved.mutate({ id }, { onSettled: () => setTestingId(null) });
  }

  const stdio = draft.transport === 'stdio';

  return (
    <View style={styles.panel} testID="connections-mcp">
      {rows.map((row) => (
        <ConnectionRow
          key={row.id}
          name={row.name}
          status={connectionStatusView(row)}
          details={mcpRowDetails(row, allRows)}
          // AL-045: a server that fails to start shows its error output here.
          problem={row.status === 'error' ? (row.statusMessage ?? 'The server did not start.') : null}
          highlighted={draft.replacing?.id === row.id}
          testID={`connection-${row.id}`}
          actions={
            <>
              <Button label="Test" variant="secondary" size="sm" loading={testingId === row.id} onPress={() => retest(row.id)} testID={`connection-${row.id}-test`} />
              {row.builtInFor ? null : (
                <>
                  <Button label="Replace" variant="secondary" size="sm" onPress={() => startReplace(row)} testID={`connection-${row.id}-replace`} />
                  <RemoveConnectionButton
                    name={row.name}
                    busy={removeConnection.isPending}
                    onRemove={() => removeConnection.mutate(row.id)}
                    testID={`connection-${row.id}-remove`}
                  />
                </>
              )}
            </>
          }
        >
          {row.tools && row.tools.length > 0 ? (
            <Text variant="mono" size="xs" numberOfLines={2} selectable>
              {row.tools.slice(0, 12).join(' · ') + (row.tools.length > 12 ? ' …' : '')}
            </Text>
          ) : null}
        </ConnectionRow>
      ))}

      <ConnectionForm
        title={draft.replacing ? `Change ${draft.replacing.name}` : 'Add an MCP server'}
        aside={draft.replacing ? <Button label="Cancel replace" variant="secondary" size="sm" onPress={draft.cancelReplace} /> : undefined}
        testID="mcp-draft"
      >
        <View style={styles.pair}>
          <TextField label="Name" placeholder="github" value={draft.name} onChangeText={draft.setName} style={styles.half} testID="mcp-name" />
          <View style={[styles.half, styles.labelled]}>
            <Text variant="title" aria-hidden>
              Transport
            </Text>
            <SegmentedControl<McpTransportType>
              label="Transport"
              tone="ink"
              value={draft.transport}
              onChange={draft.setTransport}
              options={[
                { value: 'stdio', label: 'Command', accessibilityLabel: 'Command (stdio)' },
                { value: 'http', label: 'HTTP' },
                { value: 'sse', label: 'SSE' },
              ]}
              testID="mcp-transport"
            />
          </View>
        </View>
        {stdio ? (
          <View style={styles.pair}>
            <TextField label="Command" placeholder="npx" value={draft.command} onChangeText={draft.setCommand} autoComplete="off" style={styles.half} testID="mcp-command" />
            <TextField
              label="Arguments"
              placeholder="-y @modelcontextprotocol/server-github"
              help='Separated by spaces; put "quotes" around one with spaces.'
              value={draft.args}
              onChangeText={draft.setArgs}
              autoComplete="off"
              style={styles.half}
              testID="mcp-args"
            />
          </View>
        ) : (
          <TextField label="Server URL" placeholder="https://example.com/mcp" value={draft.url} onChangeText={draft.setUrl} inputMode="url" autoComplete="off" testID="mcp-url" />
        )}
        <View style={styles.pair}>
          <TextField
            label={stdio ? 'Token environment variable (optional)' : 'Token header (optional)'}
            placeholder={stdio ? 'GITHUB_PERSONAL_ACCESS_TOKEN' : 'Authorization'}
            value={draft.tokenSlot}
            onChangeText={draft.setTokenSlot}
            error={draft.slotError}
            autoComplete="off"
            style={styles.half}
            testID="mcp-token-slot"
          />
          <TextField
            ref={tokenRef}
            variant="secure"
            label="Token (optional)"
            help="Given to the server when an agent starts it; never shown again."
            onSecretChange={draft.onTokenChange}
            style={styles.half}
            testID="mcp-token"
          />
        </View>
        <View style={styles.buttons}>
          <Button
            label="Test connection"
            variant="secondary"
            loading={draft.test.state === 'testing'}
            disabled={!draft.canTest && draft.test.state !== 'testing'}
            onPress={() => void draft.runTest()}
            testID="mcp-test-connection"
          />
        </View>
        <TestOutcome
          test={draft.test}
          passedText={`Server started · ${draft.test.result?.tools?.length ?? 0} tools`}
          testID="mcp-test-outcome"
        />
        {draft.saveError ? (
          <Text variant="meta" color={tone.danger.text} role="alert">
            {draft.saveError}
          </Text>
        ) : null}
      </ConnectionForm>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.lg,
  },
  pair: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  half: {
    flex: 1,
  },
  labelled: {
    gap: 6,
  },
  buttons: {
    flexDirection: 'row',
  },
});
