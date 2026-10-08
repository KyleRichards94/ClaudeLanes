import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { McpConnectionSummary } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { Button } from '@agent-lanes/ui';
import { fakeConnections, fakeMcpRow, fakeTestResult, installFakeBridge, type FakeConnections } from '@/shared/testing';
import { joinArgs, splitArgs, useMcpDraft } from '../model/use-mcp-draft';
import { McpServersPanel } from './McpServersPanel';

/**
 * AL-220: the MCP servers slice end to end in the renderer (panel, draft and shared mutations) against
 * the fake main process. The Connections modal's test adds a stdio server; this one covers an http
 * server with a token, a failing server and replacing a saved one.
 */

/** Made up for these tests. */
const FAKE_TOKEN = 'fake-mcp-token-0000-slice-only-77Zq';

function Host({ rows }: { rows: readonly McpConnectionSummary[] }) {
  const draft = useMcpDraft();
  return (
    <>
      <McpServersPanel draft={draft} rows={rows} allRows={rows} target={null} request={0} />
      <Button label="Save" disabled={draft.status !== 'passed'} onPress={() => void draft.save().catch(() => undefined)} testID="save" />
    </>
  );
}

function setup(rows: McpConnectionSummary[] = []): FakeConnections {
  const connections = fakeConnections(installFakeBridge(), rows);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <Host rows={rows} />
    </QueryClientProvider>,
  );
  return connections;
}

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const saveDisabled = () => (screen.getByTestId('save') as HTMLButtonElement).disabled;

describe('mcp-servers (AL-084, AL-220)', () => {
  it('adds an http server with a token: Save waits for a passing test, then sends it once', async () => {
    const connections = setup();
    fireEvent.click(within(screen.getByTestId('mcp-transport')).getByRole('radio', { name: /http/i }));
    type('mcp-name', 'tracker');
    type('mcp-url', 'https://mcp.example.test/mcp');
    type('mcp-token-slot', 'Authorization');
    fireEvent.change(screen.getByTestId('mcp-token'), { target: { value: FAKE_TOKEN } });
    expect(saveDisabled()).toBe(true);

    fireEvent.click(screen.getByTestId('mcp-test-connection'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    const tested = connections.calls.find((call) => call.channel === 'connections:test')?.payload as { draft: Record<string, unknown> };
    expect(tested.draft).toMatchObject({ kind: 'mcp', name: 'tracker', transport: { type: 'http', url: 'https://mcp.example.test/mcp', header: 'Authorization' }, token: FAKE_TOKEN });

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.some((call) => call.channel === 'connections:save')).toBe(true));
    expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toMatchObject({ kind: 'mcp', name: 'tracker', token: FAKE_TOKEN });
    await waitFor(() => expect((screen.getByTestId('mcp-token') as HTMLInputElement).value).toBe(''));
  });

  it("keeps a server that won't start unsaved, with its error in words", async () => {
    const connections = setup();
    connections.testDraft = () => fakeTestResult({ status: 'error', message: "spawn nope ENOENT: 'nope' is not a command" });
    type('mcp-name', 'broken');
    type('mcp-command', 'nope');
    fireEvent.click(screen.getByTestId('mcp-test-connection'));
    expect(await screen.findByText("spawn nope ENOENT: 'nope' is not a command")).toBeTruthy();
    expect(saveDisabled()).toBe(true);
  });

  it('replaces a saved server under its id, with its command and arguments filled in', async () => {
    const connections = setup([fakeMcpRow()]);
    fireEvent.click(screen.getByTestId('connection-mcp:github-replace'));
    expect((screen.getByTestId('mcp-command') as HTMLInputElement).value).toBe('npx');
    expect((screen.getByTestId('mcp-args') as HTMLInputElement).value).toBe('-y @modelcontextprotocol/server-github');
    fireEvent.click(screen.getByTestId('mcp-test-connection'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:replace')?.payload).toMatchObject({ id: 'mcp:github', draft: { kind: 'mcp', name: 'github' } }));
  });

  it('splits and joins arguments with quotes the way a shell would', () => {
    expect(splitArgs('server.mjs "two words" --flag')).toEqual(['server.mjs', 'two words', '--flag']);
    expect(joinArgs(['server.mjs', 'two words'])).toBe('server.mjs "two words"');
  });
});
