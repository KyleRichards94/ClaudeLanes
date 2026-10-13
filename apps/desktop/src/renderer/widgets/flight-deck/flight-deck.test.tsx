import type { AgentOutputItem } from '@agent-lanes/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentOutputStore, resetExpandedRows, type AgentOutputStore } from '@/entities/agent-output';
import { deriveTurns } from '@/entities/turn';
import { getTicketView, resetTicketViews, selectFile, selectTurn } from '@/shared/model';
import { fakeOutputEvent, installFakeBridge } from '@/shared/testing';
import { LEAD, agents, file, files, gates, reviewStatus, steps, turns } from './model/fixture';
import { reviewProgress, workflowStages } from './model/stage-meta';
import { AgentDonut } from './ui/AgentDonut';
import { ChangeMap } from './ui/ChangeMap';
import { DiffColumn, type DiffColumnProps } from './ui/DiffColumn';
import { FlightDeck } from './ui/FlightDeck';
import { GroupedOutput } from './ui/GroupedOutput';
import { TurnStrip } from './ui/TurnStrip';
import { WorkflowCard } from './ui/WorkflowCard';

const TICKET = LEAD;

beforeEach(() => {
  resetTicketViews();
  resetExpandedRows();
});

describe('TurnStrip (handoff: turn strip)', () => {
  it('draws one button per turn, the live one last, with the total at the right', () => {
    render(<TurnStrip turns={turns} agents={agents} selectedTurn={null} onSelectTurn={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Turn 3, 8m 00s, $0.50, led by Lead' }).textContent).toBe('T3$0.50');
    expect(screen.getByRole('button', { name: 'Turn 7, running, live, led by Lead' })).toBeTruthy();
    expect(screen.getByTestId('turn-total').textContent).toBe('7 turns · $2.06');
  });

  it('sets selectedTurn when a turn is pressed, and marks the selected one', () => {
    function Strip() {
      const selected = getTicketView(TICKET).selectedTurn;
      return <TurnStrip turns={turns} agents={agents} selectedTurn={selected} onSelectTurn={(index) => selectTurn(TICKET, index)} />;
    }
    const { rerender } = render(<Strip />);
    fireEvent.click(screen.getByTestId('turn-3'));
    expect(getTicketView(TICKET).selectedTurn).toBe(3);
    rerender(<Strip />);
    expect(screen.getByTestId('turn-3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('turn-4').getAttribute('aria-pressed')).toBe('false');
  });

  it('draws nothing before there is a turn', () => {
    const { container } = render(<TurnStrip turns={[]} agents={agents} selectedTurn={null} onSelectTurn={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('WorkflowCard (handoff: stage cards)', () => {
  const stages = workflowStages({ steps, gates, waitingStage: null, turns, progress: null, review: null });
  const renderCard = (overrides: Partial<Parameters<typeof WorkflowCard>[0]> = {}) =>
    render(<WorkflowCard stages={stages} onGateChange={vi.fn()} turns={turns} agents={agents} selectedTurn={null} onSelectTurn={vi.fn()} {...overrides} />);

  it('shows done, current and future stages with their gate chip and meta line', () => {
    renderCard();
    const list = screen.getByTestId('stage-stepper');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);

    const planning = screen.getByTestId('stage-step-planning');
    expect(planning.getAttribute('aria-label')).toBe('Planning, done, 12m');
    expect(within(planning).getByText('Approved')).toBeTruthy();
    expect(screen.getByTestId('stage-meta-planning').textContent).toBe('12m · 2 turns · $0.30');

    const implementing = screen.getByTestId('stage-step-implementing');
    expect(implementing.getAttribute('aria-label')).toBe('Implementing, current stage');
    expect(within(implementing).getByText('Auto')).toBeTruthy();
    expect(screen.getByTestId('stage-meta-implementing').textContent).toBe('Working…');

    expect(within(screen.getByTestId('stage-step-code-review')).getByText('Auto')).toBeTruthy();
    expect(screen.getByTestId('stage-meta-code-review').textContent).toBe('reviews the diff');
    expect(screen.getByTestId('stage-meta-create-pr').textContent).toBe('waits for you');
    expect(within(screen.getByTestId('stage-step-create-pr')).getByText('Approval')).toBeTruthy();
  });

  it('draws a bar for the current stage only: a shimmer without progress, filled to the progress with it', () => {
    const { unmount } = renderCard();
    expect(screen.getAllByTestId('stage-progress')).toHaveLength(1);
    expect(screen.getByTestId('stage-progress').getAttribute('aria-valuetext')).toBe('In progress');
    unmount();

    const withProgress = workflowStages({ steps, gates, waitingStage: null, turns, progress: 0.46, review: reviewProgress(files.map((f) => f.path), reviewStatus) });
    renderCard({ stages: withProgress });
    expect(screen.getByTestId('stage-progress').getAttribute('aria-valuenow')).toBe('46');
    expect(screen.getByTestId('stage-meta-implementing').textContent).toBe('46% done');
  });

  it('flips a stage gate from its chip, and leaves it a plain label when it cannot', () => {
    const onGateChange = vi.fn();
    const { unmount } = renderCard({ onGateChange });
    const qa = screen.getByTestId('stage-gate-qa');
    expect(qa.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(qa);
    expect(onGateChange).toHaveBeenCalledWith('qa', 'approval');
    fireEvent.click(screen.getByTestId('stage-gate-planning'));
    expect(onGateChange).toHaveBeenCalledWith('planning', 'auto');
    unmount();

    renderCard({ onGateChange: undefined });
    expect(screen.queryByTestId('stage-gate-qa')).toBeNull();
  });

  it('shows the gate actions and notices under the turn strip, and the waiting stage in amber words', () => {
    const waiting = workflowStages({ steps, gates, waitingStage: 'implementing', turns, progress: null, review: null });
    renderCard({ stages: waiting, gateActions: <span data-testid="gate-actions">approve</span>, notices: <span data-testid="notices">needs you</span> });
    expect(screen.getByTestId('stage-step-implementing').getAttribute('aria-label')).toMatch(/waiting for approval$/);
    expect(screen.getByTestId('stage-meta-implementing').textContent).toBe('Waiting for your approval');
    expect(screen.getByTestId('gate-actions')).toBeTruthy();
    expect(screen.getByTestId('notices')).toBeTruthy();
  });
});

describe('ChangeMap (handoff: change map)', () => {
  const props = { files, agents, selectedPath: null, onSelectFile: vi.fn(), loading: false, error: null, onRetry: vi.fn() };

  it('draws a tile per file, biggest change first, with the legend of agent colours', () => {
    render(<ChangeMap {...props} />);
    const tiles = within(screen.getByRole('group', { name: 'Changed files' })).getAllByRole('button');
    expect(tiles.map((tile) => tile.textContent)).toEqual(['FailedSyncFiles.razor', 'FailedSyncFilesTests.cs', 'frmFailedFiles.vb', 'FailedSyncFiles.razor.cs', 'CompanionGridFormatter.cs']);
    expect(tiles[0]!.getAttribute('aria-label')).toBe('FailedSyncFiles.razor, 120 lines added, 0 removed, by Lead');

    const legend = screen.getByTestId('change-map-legend');
    for (const name of ['Lead', 'razor-writer', 'test-writer', 'you or a merge']) expect(within(legend).getByText(name)).toBeTruthy();
    expect(within(legend).queryByText('reviewer')).toBeNull();
    expect(within(legend).getByText('width = lines changed')).toBeTruthy();
  });

  it('sets selectedFilePath when a tile is pressed, and rings the selected one', () => {
    function Map() {
      const selected = getTicketView(TICKET).selectedFilePath;
      return <ChangeMap {...props} selectedPath={selected} onSelectFile={(path) => selectFile(TICKET, path)} />;
    }
    const { rerender } = render(<Map />);
    fireEvent.click(screen.getByTestId('change-tile-tests/FailedSyncFilesTests.cs'));
    expect(getTicketView(TICKET).selectedFilePath).toBe('tests/FailedSyncFilesTests.cs');
    rerender(<Map />);
    expect(screen.getByTestId('change-tile-tests/FailedSyncFilesTests.cs').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('change-tile-legacy/frmFailedFiles.vb').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows skeleton tiles while loading, the empty note with no changes, and the error with Retry', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ChangeMap {...props} files={[]} loading />);
    expect(screen.getByTestId('change-map-loading').getAttribute('aria-busy')).toBe('true');

    rerender(<ChangeMap {...props} files={[]} />);
    expect(screen.getByTestId('change-map-empty').textContent).toBe('No changes against the base yet.');

    rerender(<ChangeMap {...props} files={[]} error={{ message: 'git failed' }} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('git failed');
    fireEvent.click(screen.getByTestId('change-map-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('marks a rename with ↷ and a binary file with "binary"', () => {
    render(<ChangeMap {...props} files={[file('a/New.cs', 4, 1, { kind: 'renamed', oldPath: 'a/Old.cs' }), file('img/logo.png', 0, 0, { kind: 'binary' })]} />);
    expect(screen.getByTestId('change-tile-a/New.cs').textContent).toBe('↷ New.cs');
    expect(within(screen.getByTestId('change-tile-img/logo.png')).getByText('binary')).toBeTruthy();
  });

  it('keeps showing the tiles while a refresh is loading', () => {
    render(<ChangeMap {...props} loading />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.queryByTestId('change-map-loading')).toBeNull();
  });
});

describe('DiffColumn (handoff: diff column)', () => {
  const column = (overrides: Partial<DiffColumnProps> = {}): DiffColumnProps => ({
    files,
    agents,
    selectedFilePath: null,
    onSelectFile: vi.fn(),
    loading: false,
    error: null,
    onRetry: vi.fn(),
    followAgent: false,
    onFollowChange: vi.fn(),
    latestActivityPath: null,
    diffMode: 'unified',
    onDiffModeChange: vi.fn(),
    renderDiff: vi.fn((f, mode, stripe) => <span data-testid="diff">{`${f.path}|${mode}|${stripe}`}</span>),
    ...overrides,
  });

  it('heads the column with the totals and the uncommitted chip, and shows the biggest change by default', () => {
    render(<DiffColumn {...column()} />);
    expect(screen.getByText('Ticket branch vs base')).toBeTruthy();
    expect(screen.getByTestId('diff-totals').textContent).toBe('5 files · +231 −47');
    expect(screen.getByText('Includes uncommitted changes')).toBeTruthy();
    expect(screen.getByTestId('diff-file-path').textContent).toBe('src/Pages/Companion/FailedSyncFiles.razor');
    expect(screen.getByTestId('diff-file-author').textContent).toBe('by Lead');
    // The diff gets the author's colour for its stripe.
    expect(screen.getByTestId('diff').textContent).toBe('src/Pages/Companion/FailedSyncFiles.razor|unified|#5B4BC4');
  });

  it('shows the selected file with its author, colour and counts', () => {
    render(<DiffColumn {...column({ selectedFilePath: 'legacy/frmFailedFiles.vb', diffMode: 'split' })} />);
    expect(screen.getByTestId('diff-file-path').textContent).toBe('legacy/frmFailedFiles.vb');
    expect(screen.getByTestId('diff-file-author').textContent).toBe('by you or a merge');
    expect(within(screen.getByTestId('diff-file-header')).getByText('+3')).toBeTruthy();
    expect(within(screen.getByTestId('diff-file-header')).getByText('−44')).toBeTruthy();
    expect(screen.getByTestId('diff').textContent).toBe('legacy/frmFailedFiles.vb|split|#94A3B8');
  });

  it('switches Unified and Split, and Follow agent', () => {
    const onDiffModeChange = vi.fn();
    const onFollowChange = vi.fn();
    render(<DiffColumn {...column({ onDiffModeChange, onFollowChange })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }));
    expect(onDiffModeChange).toHaveBeenCalledWith('split');
    fireEvent.click(screen.getByRole('switch', { name: 'Follow agent' }));
    expect(onFollowChange).toHaveBeenCalledWith(true);
  });

  it('with Follow agent on, selects the file the agent last edited, once, and not with it off', () => {
    const onSelectFile = vi.fn();
    const path = 'src/Pages/Companion/FailedSyncFiles.razor.cs';
    const { rerender } = render(<DiffColumn {...column({ onSelectFile, latestActivityPath: path })} />);
    expect(onSelectFile).not.toHaveBeenCalled();

    rerender(<DiffColumn {...column({ onSelectFile, latestActivityPath: path, followAgent: true })} />);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenCalledWith(path);
    // Re-rendering with the same file does not select it again, so a click on another tile sticks.
    rerender(<DiffColumn {...column({ onSelectFile, latestActivityPath: path, followAgent: true, selectedFilePath: 'tests/FailedSyncFilesTests.cs' })} />);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    // The agent moves on: so does the selection. A file outside the diff (a read) is ignored.
    rerender(<DiffColumn {...column({ onSelectFile, latestActivityPath: 'legacy/frmFailedFiles.vb', followAgent: true })} />);
    expect(onSelectFile).toHaveBeenLastCalledWith('legacy/frmFailedFiles.vb');
    rerender(<DiffColumn {...column({ onSelectFile, latestActivityPath: 'docs/unchanged.md', followAgent: true })} />);
    expect(onSelectFile).toHaveBeenCalledTimes(2);
  });

  it('says there are no changes, and has no file panel, when nothing changed; a binary file has no diff', () => {
    const { rerender } = render(<DiffColumn {...column({ files: [] })} />);
    expect(screen.getByTestId('change-map-empty')).toBeTruthy();
    expect(screen.queryByTestId('diff-file-panel')).toBeNull();
    expect(screen.queryByTestId('diff-totals')).toBeNull();

    rerender(<DiffColumn {...column({ files: [file('img/logo.png', 0, 0, { kind: 'binary' })] })} />);
    expect(screen.getByText('Binary file — no diff.')).toBeTruthy();
    expect(screen.queryByTestId('diff')).toBeNull();
  });
});

describe('AgentDonut (handoff: Agents card)', () => {
  it('counts the agents by state in the middle and the legend, with the sub-branches ready', () => {
    render(<AgentDonut agents={agents} counts="1 running · 1 done" subBranchesReady={2} />);
    expect(screen.getByTestId('agent-donut-total').textContent).toBe('4');
    expect(screen.getByTestId('agent-donut-count-lead').textContent).toBe('1 lead');
    expect(screen.getByTestId('agent-donut-count-running').textContent).toBe('1 running');
    expect(screen.getByTestId('agent-donut-count-done').textContent).toBe('1 done');
    expect(screen.getByTestId('agent-donut-count-idle').textContent).toBe('1 idle');
    expect(screen.queryByTestId('agent-donut-count-error')).toBeNull();
    expect(screen.getByTestId('agent-donut-ready').textContent).toBe('2 sub-branches ready');
    expect(screen.getByTestId('sub-agents-counts').textContent).toBe('1 running · 1 done');
    expect(screen.getByRole('heading', { name: 'Agents', level: 2 })).toBeTruthy();
  });

  it('draws a segment per agent coloured by state', () => {
    render(<AgentDonut agents={agents} subBranchesReady={1} />);
    const state = (id: string) => screen.getByTestId(`donut-segment-${id}`);
    expect(state('ticket-11726').getAttribute('stroke')).toBe('#5B4BC4');
    expect(state('writer').getAttribute('stroke')).toBe('#818CF8');
    expect(state('tester').getAttribute('stroke')).toBe('#34D399');
    expect(state('writer').querySelector('animate')).not.toBeNull();
    expect(state('tester').querySelector('animate')).toBeNull();
    expect(screen.getByTestId('agent-donut-ready').textContent).toBe('1 sub-branch ready');
  });

  it('has a row per agent: initial, name, model, token bar, status pill; pressing a row opens it', () => {
    const onOpenAgent = vi.fn();
    render(<AgentDonut agents={agents} lines={{ writer: ['Sonnet · High', 'sub/11726-razor'] }} subBranchesReady={0} onOpenAgent={onOpenAgent} activeId="writer" />);
    const row = screen.getByTestId('agent-row-writer');
    expect(within(row).getByText('R')).toBeTruthy();
    expect(within(row).getByText('razor-writer')).toBeTruthy();
    expect(within(row).getByText('Sonnet · High')).toBeTruthy();
    expect(within(row).getByText('Running')).toBeTruthy();
    expect(within(row).getByTestId('agent-row-writer-tokens').textContent).toBe('90k tokens');
    // The lead has the most tokens, so its bar is full; an agent with no tokens has none.
    expect(within(screen.getByTestId('agent-row-ticket-11726')).getByText('212k tokens')).toBeTruthy();
    expect(screen.queryByTestId('agent-row-eyes-tokens')).toBeNull();
    // With no lines, the row says the model.
    expect(within(screen.getByTestId('agent-row-eyes')).getByText('Sonnet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'razor-writer, Running' }));
    expect(onOpenAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'writer' }));
  });

  it('says what a running agent is doing to which file, and gives each row its actions and the footer', () => {
    render(
      <AgentDonut
        agents={agents}
        subBranchesReady={0}
        renderActions={(agent) => (agent.id === 'writer' ? <button type="button">Stop writer</button> : null)}
        footer={<button type="button">Add agent</button>}
        statuses={{ eyes: { label: 'Queued', tone: 'neutral' } }}
      />,
    );
    expect(within(screen.getByTestId('agent-row-ticket-11726')).getByText('Editing FailedSyncFiles.razor')).toBeTruthy();
    expect(within(screen.getByTestId('agent-row-writer')).getByRole('button', { name: 'Stop writer' })).toBeTruthy();
    expect(within(screen.getByTestId('agent-row-eyes')).getByText('Queued')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeTruthy();
  });
});

describe('GroupedOutput (handoff: output column)', () => {
  const lead = { parentToolUseId: null };
  const items: AgentOutputItem[] = [
    { kind: 'user', text: 'Add a filter', source: 'composer', priority: null, messageId: null, ...lead },
    { kind: 'tool', rowId: 'r1', toolUseIds: ['r1'], tool: 'edit', label: 'Edit', detail: 'Pages/Grid.razor', stats: null, ...lead },
    { kind: 'tool', rowId: 'r2', toolUseIds: ['r2'], tool: 'bash', label: 'Bash', detail: 'dotnet build', stats: null, ...lead },
    { kind: 'text', streamId: 'm1', text: 'Filter added. It builds clean.', ...lead },
    { kind: 'result', subtype: 'success', isError: false, durationMs: 252_000, numTurns: 1, costUsd: 0.42, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, ...lead },
    { kind: 'user', text: 'Now the tests', source: 'composer', priority: null, messageId: null, ...lead },
    { kind: 'tool', rowId: 'r3', toolUseIds: ['r3'], tool: 'bash', label: 'Bash', detail: 'dotnet test', stats: null, ...lead },
    { kind: 'text-delta', streamId: 'm2', text: 'Running the tests', ...lead },
  ];
  const events = items.map((item, index) => fakeOutputEvent(TICKET, 1_000 + index * 100, { seq: index + 1, item }));
  const grouped = deriveTurns(events, [{ stage: 'implementing', at: 0 }]);
  let store: AgentOutputStore;

  beforeEach(() => {
    installFakeBridge();
    store = createAgentOutputStore(20_000);
  });

  function renderOutput() {
    render(<GroupedOutput ticketId={TICKET} turns={grouped} agents={agents} selectedTurn={null} stream={{ store }} composer={<div data-testid="composer">composer</div>} />);
    act(() => store.receive(events));
  }

  it('collapses a finished turn to its summary: sentence, "Turn 1 · 4m 12s · $0.42", top tools', () => {
    renderOutput();
    const row = screen.getByTestId('turn-row-1');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(within(row).getByText('Filter added.')).toBeTruthy();
    expect(within(row).getByText('Turn 1 · 4m 12s · $0.42')).toBeTruthy();
    expect(within(row).getByText('Bash 1 · Edit 1')).toBeTruthy();
    // Its transcript is not drawn.
    expect(screen.queryByText('Pages/Grid.razor')).toBeNull();
    expect(screen.queryByText('Add a filter')).toBeNull();
  });

  it('keeps the live turn open with a pulsing dot and its rows, and the composer under the stream', () => {
    renderOutput();
    const live = screen.getByTestId('turn-row-2');
    expect(live.getAttribute('aria-label')).toBe('Turn 2, running led by Lead');
    expect(live.getAttribute('aria-expanded')).toBeNull();
    expect(screen.getByTestId('turn-live-dot')).toBeTruthy();
    expect(screen.getByText('dotnet test')).toBeTruthy();
    expect(screen.getByText('Now the tests')).toBeTruthy();
    expect(screen.getByTestId('composer')).toBeTruthy();
  });

  it('opens a finished turn to its full transcript on a click, and closes it again', () => {
    renderOutput();
    fireEvent.click(screen.getByTestId('turn-row-1'));
    expect(screen.getByTestId('turn-row-1').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Pages/Grid.razor')).toBeTruthy();
    expect(screen.getByText('Add a filter')).toBeTruthy();

    fireEvent.click(screen.getByTestId('turn-row-1'));
    expect(screen.queryByText('Pages/Grid.razor')).toBeNull();
  });

  it('highlights the selected turn', () => {
    render(<GroupedOutput ticketId={TICKET} turns={grouped} agents={agents} selectedTurn={1} stream={{ store }} composer={null} />);
    act(() => store.receive(events));
    expect(screen.getByTestId('turn-row-1')).toBeTruthy();
  });
});

describe('FlightDeck frame', () => {
  const frame = (overrides: Partial<Parameters<typeof FlightDeck>[0]> = {}) => (
    <FlightDeck
      wide
      stackedHeight={480}
      tab="output"
      tabIdPrefix="ticket-tabs"
      workflow={<div data-testid="workflow">workflow</div>}
      tabs={<div data-testid="tabs">tabs</div>}
      output={<div data-testid="output">output</div>}
      diff={<div data-testid="diff-column">diff</div>}
      diffShown
      other={<div data-testid="other">build log</div>}
      rail={<div data-testid="rail">rail</div>}
      {...overrides}
    />
  );

  it('puts the output, the diff and the rail in one row when wide, under the workflow and the tabs', () => {
    render(frame());
    const body = screen.getByTestId('ticket-body-wide');
    expect(within(body).getByTestId('output')).toBeTruthy();
    expect(within(body).getByTestId('diff-column')).toBeTruthy();
    expect(within(screen.getByTestId('ticket-side-column')).getByTestId('rail')).toBeTruthy();
    expect(screen.getByTestId('ticket-tab-panel').getAttribute('role')).toBe('tabpanel');
    expect(screen.queryByTestId('ticket-body-stacked')).toBeNull();
    const order = [...screen.getByTestId('flight-deck').children].map((node) => node.getAttribute('data-testid'));
    expect(order).toEqual(['workflow', 'tabs', 'ticket-body-wide']);
  });

  it('moves the rail under the columns, each a fixed height, below 1200 px', () => {
    render(frame({ wide: false, stackedHeight: 520 }));
    const body = screen.getByTestId('ticket-body-stacked');
    const panel = within(body).getByTestId('ticket-tab-panel');
    expect(within(panel).getByTestId('output')).toBeTruthy();
    expect((within(panel).getByTestId('output').parentElement as HTMLElement).style.height).toBe('520px');
    // The rail follows the panel in the DOM.
    expect(panel.nextElementSibling).toBe(screen.getByTestId('ticket-side-column'));
  });

  it('gives the output the whole width when the diff is hidden, and swaps the columns for Build log or ADO', () => {
    const { rerender } = render(frame({ diffShown: false }));
    expect(screen.getByTestId('output')).toBeTruthy();
    expect(screen.queryByTestId('diff-column')).toBeNull();

    rerender(frame({ tab: 'build-log' }));
    expect(screen.getByTestId('other')).toBeTruthy();
    expect(screen.queryByTestId('output')).toBeNull();
    expect(screen.getByTestId('rail')).toBeTruthy();
  });
});
