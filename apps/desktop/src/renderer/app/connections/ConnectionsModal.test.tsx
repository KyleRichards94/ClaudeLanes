import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLAUDE_LOGIN_CONNECTED_TEXT, type ConnectionSummary } from '@agent-lanes/contracts';
import { openConnections, resetConnectionsModal } from '@/shared/model';
import {
  fakeAdoRow,
  fakeClaudeRow,
  fakeConnections,
  fakeMcpRow,
  fakeTestResult,
  installFakeBridge,
  type FakeConnections,
} from '@/shared/testing';
import { CONNECTIONS_LOCK_NOTE, CONNECTIONS_SUBTITLE, ConnectionsModal, canSaveDrafts } from './ConnectionsModal';

/** Made up for these tests; shaped like a PAT, valid nowhere. */
const FAKE_PAT = 'fakepat0000unit1111modal2222only3333here4444zz7Q';

function setup(rows: ConnectionSummary[] = []): FakeConnections {
  const connections = fakeConnections(installFakeBridge(), rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConnectionsModal />
    </QueryClientProvider>,
  );
  return connections;
}

const dialog = () => screen.getByRole('dialog', { name: 'Connections' });
const saveButton = () => screen.getByTestId('connections-save');
const isDisabled = (element: HTMLElement) => element.closest('button')?.disabled ?? element.getAttribute('aria-disabled') === 'true';

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

describe('ConnectionsModal (AL-046)', () => {
  beforeEach(() => {
    resetConnectionsModal();
  });

  it('matches artboard 5: header note, three tabs with status words, the add form and the footer', async () => {
    setup([fakeAdoRow(), fakeClaudeRow()]);
    act(() => openConnections());

    expect(within(dialog()).getByText(CONNECTIONS_SUBTITLE)).toBeTruthy();
    expect(await screen.findByRole('tab', { name: 'Azure DevOps, Connected' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Claude, Connected' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'MCP servers, Not connected' })).toBeTruthy();

    const row = await screen.findByTestId('connection-ado:companionsystems');
    expect(within(row).getByText('CompanionSystems')).toBeTruthy();
    expect(within(row).getByText('Connected')).toBeTruthy();
    expect(screen.getByTestId('connection-ado:companionsystems-details').textContent).toBe(
      'dev.azure.com/CompanionSystems · signed in as Kyle Richards · token ••••••••7Fq2',
    );
    expect(within(row).getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeTruthy();

    expect(screen.getByRole('group', { name: 'Add another organisation' })).toBeTruthy();
    expect(screen.getByText('Organisation URL')).toBeTruthy();
    expect(screen.getByPlaceholderText('Loaded after the token is tested')).toBeTruthy();
    expect(screen.getByText(/User settings › Personal access tokens/)).toBeTruthy();
    for (const chip of ['work-items', 'code', 'build']) expect(screen.getByTestId(`ado-scope-${chip}`)).toBeTruthy();
    expect(screen.getByText(CONNECTIONS_LOCK_NOTE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('warns, without blocking, when an on-premises organisation uses plain http', () => {
    setup();
    act(() => openConnections());

    type('ado-org-url', 'https://dev.azure.com/Hicora');
    expect(screen.queryByText(/token is sent unencrypted/)).toBeNull();
    type('ado-org-url', 'http://devops:8090/CompanionSystems');
    expect(screen.getByText('Plain http: the token is sent unencrypted. Use it only on a trusted internal network.')).toBeTruthy();
  });

  it('keeps Save disabled until the draft row has passed Test connection, then saves without keeping the token', async () => {
    const connections = setup();
    act(() => openConnections());

    expect(isDisabled(saveButton())).toBe(true);
    type('ado-org-url', 'https://dev.azure.com/Hicora');
    type('ado-pat', FAKE_PAT);
    expect(isDisabled(saveButton())).toBe(true);

    fireEvent.click(screen.getByTestId('ado-test-connection'));
    expect(await screen.findByText('Connection works · signed in as Kyle Richards')).toBeTruthy();
    expect(isDisabled(saveButton())).toBe(false);
    // Projects load after the test, and the first is offered.
    expect((screen.getByTestId('ado-default-project') as HTMLInputElement).value).toBe('OnSite Companion');
    expect(screen.getByTestId('ado-scope-build').textContent).toContain('Build · ok');

    // Any edit to the token sends it back for another test.
    type('ado-pat', `${FAKE_PAT}x`);
    expect(isDisabled(saveButton())).toBe(true);
    type('ado-pat', FAKE_PAT);
    fireEvent.click(screen.getByTestId('ado-test-connection'));
    await waitFor(() => expect(isDisabled(saveButton())).toBe(false));

    fireEvent.click(saveButton());
    await waitFor(() => expect(connections.calls.some((call) => call.channel === 'connections:save')).toBe(true));
    expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toEqual({
      kind: 'ado',
      orgUrl: 'https://dev.azure.com/Hicora',
      pat: FAKE_PAT,
      defaultProject: 'OnSite Companion',
      expiresAt: null,
    });
    // The modal closes after saving; the field gave the token up.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connections' })).toBeNull());

    act(() => openConnections());
    expect(await screen.findByTestId('connection-ado:hicora')).toBeTruthy();
    expect((screen.getByTestId('ado-pat') as HTMLInputElement).value).toBe('');
  });

  it('shows a missing scope on its chip in words, and a failed test in red', async () => {
    const connections = setup();
    act(() => openConnections());
    connections.testDraft = () =>
      fakeTestResult({
        identity: 'Kyle Richards',
        projects: ['OnSite Companion'],
        missingScopes: ['build'],
        scopes: [
          { scope: 'work-items', access: 'read', status: 'granted' },
          { scope: 'work-items', access: 'write', status: 'unverified' },
          { scope: 'code', access: 'read', status: 'granted' },
          { scope: 'code', access: 'write', status: 'unverified' },
          { scope: 'build', access: 'read', status: 'missing' },
        ],
      });

    type('ado-org-url', 'https://dev.azure.com/Hicora');
    type('ado-pat', FAKE_PAT);
    fireEvent.click(screen.getByTestId('ado-test-connection'));
    await waitFor(() => expect(screen.getByTestId('ado-scope-build').textContent).toContain('Build · missing'));
    expect(screen.getByText(/missing Build \(read\)/)).toBeTruthy();

    connections.testDraft = () => fakeTestResult({ status: 'error', message: 'Azure DevOps refused this token.' });
    type('ado-pat', `${FAKE_PAT}y`);
    fireEvent.click(screen.getByTestId('ado-test-connection'));
    expect(await screen.findByText('Azure DevOps refused this token.')).toBeTruthy();
    expect(isDisabled(saveButton())).toBe(true);
  });

  it('lands on the row a Reconnect names, with its PAT field focused', async () => {
    setup([fakeAdoRow({ status: 'error', needsReconnect: true, statusMessage: 'The saved token can no longer be read. Replace it.' })]);
    await act(async () => openConnections({ connectionId: 'ado:companionsystems' }));

    expect(await screen.findByRole('group', { name: 'Replace the token for CompanionSystems' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('ado-pat')));
    expect((screen.getByTestId('ado-org-url') as HTMLInputElement).value).toBe('https://dev.azure.com/CompanionSystems');
    const row = screen.getByTestId('connection-ado:companionsystems');
    expect(within(row).getByText('Reconnect needed')).toBeTruthy();
    expect(within(row).getByText('The saved token can no longer be read. Replace it.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Azure DevOps, Needs attention' })).toBeTruthy();
  });

  it('replaces a token with Replace, keeping the row', async () => {
    const connections = setup([fakeAdoRow()]);
    act(() => openConnections());
    fireEvent.click(await screen.findByTestId('connection-ado:companionsystems-replace'));
    type('ado-pat', FAKE_PAT);
    fireEvent.click(screen.getByTestId('ado-test-connection'));
    await waitFor(() => expect(isDisabled(saveButton())).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(connections.calls.some((call) => call.channel === 'connections:replace')).toBe(true));
    expect(connections.calls.find((call) => call.channel === 'connections:replace')?.payload).toMatchObject({ id: 'ado:companionsystems', draft: { kind: 'ado', pat: FAKE_PAT } });
  });

  it('removes a row only after a second press', async () => {
    const connections = setup([fakeAdoRow()]);
    act(() => openConnections());
    fireEvent.click(await screen.findByTestId('connection-ado:companionsystems-remove'));
    expect(connections.calls.some((call) => call.channel === 'connections:remove')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove CompanionSystems' }));
    await waitFor(() => expect(screen.queryByTestId('connection-ado:companionsystems')).toBeNull());
  });

  it('shows the Claude login status line once connected', async () => {
    setup([fakeClaudeRow()]);
    act(() => openConnections({ tab: 'claude' }));
    const row = await screen.findByTestId('connection-claude');
    expect(within(row).getByText(`${CLAUDE_LOGIN_CONNECTED_TEXT} · kyle@example.test (Companion Systems)`)).toBeTruthy();
  });

  it('keeps an invalid API key red with its error', async () => {
    setup([fakeClaudeRow({ mode: 'api-key', maskedToken: '••••••••Ab12', status: 'error', statusMessage: 'Anthropic refused this API key.' })]);
    act(() => openConnections({ tab: 'claude' }));
    const row = await screen.findByTestId('connection-claude');
    expect(within(row).getByText('Not connected')).toBeTruthy();
    expect(within(row).getByText('Anthropic refused this API key.')).toBeTruthy();
  });

  it('connects Claude with the login it finds: detect, test, save', async () => {
    const connections = setup();
    act(() => openConnections({ tab: 'claude' }));
    expect(await screen.findByText('Found a Claude Code login: kyle@example.test (Companion Systems)')).toBeTruthy();
    expect(isDisabled(saveButton())).toBe(true);
    fireEvent.click(screen.getByTestId('claude-test-connection'));
    await waitFor(() => expect(isDisabled(saveButton())).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toEqual({ kind: 'claude', mode: 'login' }),
    );
  });

  it('does not look for a Claude login until the Claude tab is shown', async () => {
    const connections = setup();
    act(() => openConnections());
    await screen.findByTestId('connections-ado');
    expect(connections.calls.some((call) => call.channel === 'connections:detectClaude')).toBe(false);
  });

  it("shows an MCP server's error output in its row", async () => {
    setup([fakeMcpRow({ status: 'error', tools: undefined, statusMessage: "npx exited with code 1: 'server-github' not found" })]);
    act(() => openConnections({ tab: 'mcp' }));
    const row = await screen.findByTestId('connection-mcp:github');
    expect(within(row).getByText("npx exited with code 1: 'server-github' not found")).toBeTruthy();
    expect(screen.getByTestId('connection-mcp:github-details').textContent).toBe(
      'npx -y @modelcontextprotocol/server-github · token ••••••••ab12',
    );
  });

  it('adds an MCP server: Save waits for its test', async () => {
    const connections = setup();
    act(() => openConnections({ tab: 'mcp' }));
    type('mcp-name', 'echo');
    type('mcp-command', 'node');
    type('mcp-args', 'server.mjs "two words"');
    expect(isDisabled(saveButton())).toBe(true);
    fireEvent.click(screen.getByTestId('mcp-test-connection'));
    expect(await screen.findByText('Server started · 1 tools')).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toEqual({
        kind: 'mcp',
        name: 'echo',
        transport: { type: 'stdio', command: 'node', args: ['server.mjs', 'two words'], envVar: null },
      }),
    );
  });

  it('opens blocking on first run: no close button and no Cancel', () => {
    setup();
    act(() => openConnections({ blocking: true }));
    expect(within(dialog()).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Connections' })).toBeTruthy();
  });

  it('Cancel empties the drafts and closes', async () => {
    setup();
    act(() => openConnections());
    type('ado-org-url', 'https://dev.azure.com/Hicora');
    type('ado-pat', FAKE_PAT);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Connections' })).toBeNull();
    act(() => openConnections());
    await screen.findByTestId('connections-ado');
    expect((screen.getByTestId('ado-org-url') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('ado-pat') as HTMLInputElement).value).toBe('');
  });
});

describe('canSaveDrafts', () => {
  it('needs one passed draft and none typed but untested', () => {
    expect(canSaveDrafts([{ status: 'empty' }, { status: 'empty' }])).toBe(false);
    expect(canSaveDrafts([{ status: 'passed' }, { status: 'empty' }])).toBe(true);
    expect(canSaveDrafts([{ status: 'passed' }, { status: 'untested' }])).toBe(false);
  });
});
