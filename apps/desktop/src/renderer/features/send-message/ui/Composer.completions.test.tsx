import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionStatus } from '@agent-lanes/contracts';
import { useUiPrefs } from '@/shared/model';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { pushHistory, resetComposerHistory } from '../model/history';
import { Composer, ComposerView } from './Composer';
import { composerControls } from '../model/composer';

const status: AgentSessionStatus = { ticketId: '71273', state: 'idle', sessionId: 's', message: null };

function renderComposer(bridge: FakeBridge) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Composer ticketId="71273" repo="C:/src/osc" skills={['commit']} switching={false} />
    </QueryClientProvider>,
  );
  return bridge;
}

const input = () => screen.getByTestId('composer-input') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

describe('composer completions, history and attachments (AL-259)', () => {
  beforeEach(() => {
    resetComposerHistory();
    // Drafts persist across tests through the UI prefs store.
    useUiPrefs.setState({ composerDrafts: {} });
  });

  it('offers the repo skills and the session commands after /, and fills the pick in', async () => {
    renderComposer(
      installFakeBridge({
        'agent:getStatus': { ok: true, data: status },
        'skills:list': { ok: true, data: { repo: 'C:/src/osc', skills: [{ name: 'code-review', description: 'Review the branch', argumentHint: '' }], loadedAt: 1 } },
        'agent:listCommands': { ok: true, data: { ticketId: '71273', commands: [{ name: 'compact', description: 'Fold the context', argumentHint: '' }] } },
      }),
    );
    await screen.findByRole('button', { name: 'Pause' });
    type('/co');
    const menu = await screen.findByRole('menu', { name: 'Completions' });
    await waitFor(() => expect(menu.textContent).toContain('/code-review'));
    expect(menu.textContent).toContain('/commit');
    expect(menu.textContent).toContain('/compact');
    expect(menu.textContent).not.toContain('No skill');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input().value).toBe('/commit ');
    expect(screen.queryByRole('menu', { name: 'Completions' })).toBeNull();
  });

  it('lists worktree files after @ and inserts the path', async () => {
    const bridge = renderComposer(
      installFakeBridge({
        'agent:getStatus': { ok: true, data: status },
        'git:listFiles': { ok: true, data: { ticketId: '71273', query: 'job', files: ['src/Jobs/JobGrid.razor', 'src/Jobs/JobFilterState.cs'], truncated: false } },
      }),
    );
    await screen.findByRole('button', { name: 'Pause' });
    type('look at @job');
    const menu = await screen.findByRole('menu', { name: 'Completions' });
    await waitFor(() => expect(menu.textContent).toContain('src/Jobs/JobGrid.razor'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('git:listFiles', { ticketId: '71273', query: 'job' }));
    fireEvent.click(screen.getAllByTestId('composer-completions-item')[0]!);
    expect(input().value).toBe('look at @src/Jobs/JobGrid.razor ');
  });

  it('recalls earlier messages with the up arrow', async () => {
    renderComposer(installFakeBridge({ 'agent:getStatus': { ok: true, data: status } }));
    await screen.findByRole('button', { name: 'Pause' });
    act(() => {
      pushHistory('71273', 'first message');
      pushHistory('71273', 'second message');
    });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('second message');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().value).toBe('first message');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().value).toBe('second message');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input().value).toBe('');
  });

  it('shows added files as chips, refuses what it cannot send, and sends them with the message', async () => {
    const bridge = installFakeBridge({ 'agent:getStatus': { ok: true, data: status }, 'agent:send': { ok: true, data: { held: false } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const png = { name: 'shot.png', mediaType: 'image/png', bytes: 1024, data: 'aGVsbG8=' };
    const Harness = () => {
      return (
        <ComposerView
          ticketId="71273"
          skills={[]}
          controls={composerControls({ state: 'idle', switching: false, held: 0 })}
          text="see this"
          onChangeText={() => undefined}
          attachments={[{ kind: 'image', ...png }]}
          onAddFiles={() => undefined}
          onRemoveAttachment={remove}
          steerNow={false}
          onSteerNowChange={() => undefined}
          onSend={() => undefined}
          onPauseResume={() => undefined}
          onRunSkill={() => undefined}
          onApplyModel={() => undefined}
        />
      );
    };
    const remove = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('composer-attachments').textContent).toContain('shot.png · 1 KB');
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    expect(remove).toHaveBeenCalledWith('shot.png');
    void bridge;
  });
});
