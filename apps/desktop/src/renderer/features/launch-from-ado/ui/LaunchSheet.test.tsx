import { allowedLanes, defaultSettings, type DropAction, type Settings } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { clearToasts } from '@/shared/model';
import { installFakeSettings } from '@/shared/testing';
import { useLaunchFromAdo, type AdoDrop } from '../api/launch';
import { closeLaunchSheet } from '../model/launch-sheet';
import { LaunchSheetHost } from './LaunchSheet';

const drop: AdoDrop = { source: { kind: 'board-item', id: 71318, team: 'OSC Developers', sprint: 'Sprint 42' }, lane: 'planning', repo: 'C:/src/onsite-companion' };
const planning = allowedLanes({ kind: 'board-item', id: 71318, column: 'failed', assignee: null, agentLane: null, pullRequestId: null, branch: null }, { id: 'me' }).planning as DropAction;

function settings(): Settings {
  const base = defaultSettings();
  return {
    ...base,
    dropDefaults: {
      planning: { skills: ['brainstorm'], model: 'sonnet', effort: 'xhigh' },
      implementing: { skills: [], model: 'opus', effort: 'high' },
      'answer-comments': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high' },
      'code-review': { skills: ['code-review', 'pr-comment-actioner'], model: 'opus', effort: 'high' },
      qa: { skills: ['cs-qa-wip'], model: 'sonnet', effort: 'medium' },
    },
  };
}

async function setUp() {
  const { bridge } = installFakeSettings(settings(), { 'agent:launchFromAdo': { ok: false, code: 'VALIDATION', message: 'refused for the test', details: { reason: 'refused' } } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await client.prefetchQuery({ queryKey: ['settings'], queryFn: () => settings() });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {children}
      <LaunchSheetHost />
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useLaunchFromAdo(createAgentTicketStore()), { wrapper });
  return { bridge, launch: result.current };
}

const launchCalls = (bridge: { invoke: unknown }) => (bridge.invoke as { mock: { calls: unknown[][] } }).mock.calls.filter(([channel]) => channel === 'agent:launchFromAdo');

afterEach(() => {
  act(() => closeLaunchSheet(null));
  clearToasts();
});

describe('Alt launch sheet (AL-240)', () => {
  it("opens on the lane's defaults from Settings › Drops, and Cancel changes nothing in ADO or on disk", async () => {
    const { bridge, launch } = await setUp();
    let outcome: unknown = 'pending';
    act(() => {
      void launch(drop, { alt: true, action: planning }).then((value) => (outcome = value));
    });

    const sheet = await screen.findByTestId('launch-sheet');
    expect(sheet.textContent).toContain('Plan this · #71318');
    expect((screen.getByTestId('launch-sheet-skills') as HTMLInputElement).value).toBe('/brainstorm');
    expect(screen.getByRole('radio', { name: 'Sonnet' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: /^Planning/ }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('launch-sheet-cancel'));
    await act(async () => undefined);
    expect(outcome).toBeNull();
    expect(screen.queryByTestId('launch-sheet')).toBeNull();
    // Nothing was sent to main: no ADO change, no worktree, no session.
    expect(launchCalls(bridge)).toEqual([]);
  });

  it('starts the agent with what the user chose for this one drop', async () => {
    const { bridge, launch } = await setUp();
    act(() => {
      void launch(drop, { alt: true, action: planning });
    });
    await screen.findByTestId('launch-sheet');
    fireEvent.change(screen.getByTestId('launch-sheet-skills'), { target: { value: '/brainstorm, cs-plan' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Haiku' }));
    fireEvent.click(screen.getByRole('switch', { name: /^Planning/ }));
    fireEvent.click(screen.getByTestId('launch-sheet-start'));
    await act(async () => undefined);

    expect(launchCalls(bridge)).toEqual([
      [
        'agent:launchFromAdo',
        {
          ...drop,
          overrides: {
            skills: ['brainstorm', 'cs-plan'],
            model: 'haiku',
            effort: 'xhigh',
            gates: { planning: 'auto', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
          },
        },
      ],
    ]);
  });

  it('a drop without Alt launches at once with no sheet', async () => {
    const { bridge, launch } = await setUp();
    await act(async () => {
      await launch(drop, { action: planning });
    });
    expect(screen.queryByTestId('launch-sheet')).toBeNull();
    expect(launchCalls(bridge)).toEqual([['agent:launchFromAdo', drop]]);
  });
});
