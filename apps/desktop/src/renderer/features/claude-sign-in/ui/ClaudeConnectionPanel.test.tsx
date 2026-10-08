import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClaudeConnectionSummary } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { Button } from '@agent-lanes/ui';
import { fakeClaudeRow, fakeConnections, fakeTestResult, installFakeBridge, type FakeConnections } from '@/shared/testing';
import { useClaudeDraft } from '../model/use-claude-draft';
import { ClaudeConnectionPanel } from './ClaudeConnectionPanel';

/**
 * AL-220: the Claude sign-in slice end to end in the renderer (panel, draft, shared mutations and the
 * login detection) against the fake main process. The Connections modal's test covers connecting with
 * the login it finds; this one covers the API key path, a missing login and replacing the connection.
 */

/** Made up for these tests; shaped like a key, valid nowhere. */
const TEST_KEY = 'sk-ant-test-3333-not-a-real-key-3333-Qz78';

function Host({ row, active = true }: { row?: ClaudeConnectionSummary; active?: boolean }) {
  const draft = useClaudeDraft();
  return (
    <>
      <ClaudeConnectionPanel draft={draft} row={row} active={active} target={null} request={0} />
      <Button label="Save" disabled={draft.status !== 'passed'} onPress={() => void draft.save().catch(() => undefined)} testID="save" />
    </>
  );
}

function setup(row?: ClaudeConnectionSummary): FakeConnections {
  const connections = fakeConnections(installFakeBridge(), row ? [row] : []);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <Host row={row} />
    </QueryClientProvider>,
  );
  return connections;
}

const saveDisabled = () => (screen.getByTestId('save') as HTMLButtonElement).disabled;

describe('claude-sign-in (AL-044, AL-046, AL-220)', () => {
  it('connects with an API key: Test sends it once, Save takes it and empties the field', async () => {
    const connections = setup();
    fireEvent.click(within(screen.getByTestId('claude-mode')).getByRole('radio', { name: 'Use an API key' }));
    expect(screen.queryByTestId('claude-detection')).toBeNull();
    fireEvent.change(screen.getByTestId('claude-api-key'), { target: { value: TEST_KEY } });
    expect(saveDisabled()).toBe(true);

    fireEvent.click(screen.getByTestId('claude-test-connection'));
    expect(await screen.findByText('Connection works · kyle@example.test (Companion Systems)')).toBeTruthy();
    expect(connections.calls.find((call) => call.channel === 'connections:test')?.payload).toEqual({ draft: { kind: 'claude', mode: 'api-key', apiKey: TEST_KEY } });
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:save')?.payload).toEqual({ kind: 'claude', mode: 'api-key', apiKey: TEST_KEY }));
    await waitFor(() => expect((screen.getByTestId('claude-api-key') as HTMLInputElement).value).toBe(''));
  });

  it('says when there is no Claude Code login on this computer, and a refused key stays unsaved', async () => {
    const connections = setup();
    expect(await screen.findByText('Found a Claude Code login: kyle@example.test (Companion Systems)')).toBeTruthy();
    connections.detection = { ...connections.detection, found: false, identity: null, message: 'Claude Code is not signed in. Run claude and /login.' };
    fireEvent.click(screen.getByTestId('claude-detect'));
    expect(await screen.findByText('Claude Code is not signed in. Run claude and /login.')).toBeTruthy();

    connections.testDraft = () => fakeTestResult({ status: 'error', message: 'Invalid API key · Fix external API key' });
    fireEvent.click(within(screen.getByTestId('claude-mode')).getByRole('radio', { name: 'Use an API key' }));
    fireEvent.change(screen.getByTestId('claude-api-key'), { target: { value: TEST_KEY } });
    fireEvent.click(screen.getByTestId('claude-test-connection'));
    expect(await screen.findByText('Invalid API key · Fix external API key')).toBeTruthy();
    expect(saveDisabled()).toBe(true);
  });

  it('replaces the saved connection by its id, and tests the saved one again', async () => {
    const connections = setup(fakeClaudeRow());
    expect(screen.queryByTestId('claude-draft')).toBeNull();
    fireEvent.click(screen.getByTestId('connection-claude-test'));
    await waitFor(() => expect(connections.calls).toContainEqual({ channel: 'connections:test', payload: { id: 'claude' } }));

    fireEvent.click(screen.getByTestId('connection-claude-replace'));
    expect(screen.getByRole('group', { name: 'Change how Agent Lanes signs in to Claude' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('claude-test-connection'));
    await waitFor(() => expect(saveDisabled()).toBe(false));
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(connections.calls.find((call) => call.channel === 'connections:replace')?.payload).toEqual({ id: 'claude', draft: { kind: 'claude', mode: 'login' } }));
  });
});
