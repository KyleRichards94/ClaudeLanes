import type { AgentOutputItem } from '@agent-lanes/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeOutputEvent, installFakeBridge } from '@/shared/testing';
import { resetExpandedRows } from '../model/expanded';
import { createAgentOutputStore, type AgentOutputStore } from '../model/store';
import { OutputStream } from './OutputStream';

const lead = { parentToolUseId: null };

function textEvent(seq: number, text = `line ${seq}`) {
  return fakeOutputEvent('71273', seq, { item: { kind: 'text', streamId: `msg_${seq}`, text, ...lead } });
}

function itemEvent(seq: number, item: AgentOutputItem) {
  return fakeOutputEvent('71273', seq, { item });
}

/** The scroll view as a DOM node, with the sizes jsdom does not lay out. */
function scrollNode(contentHeight: number, viewport = 500) {
  const node = screen.getByTestId('output-stream-scroll');
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: contentHeight });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: viewport });
  Object.defineProperty(node, 'offsetHeight', { configurable: true, value: viewport });
  return node;
}

function scrollTo(top: number, contentHeight: number) {
  const node = scrollNode(contentHeight);
  node.scrollTop = top;
  fireEvent.scroll(node);
}

let store: AgentOutputStore;

beforeEach(() => {
  installFakeBridge();
  store = createAgentOutputStore(20_000);
});

describe('OutputStream (AL-175)', () => {
  it('says where output will appear before there is any', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    expect(screen.getByText(/The agent's output streams here/)).toBeTruthy();
  });

  it('draws system lines, tool rows with verb chip and stats, bold prose and the streaming line with a caret', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() =>
      store.receive([
        itemEvent(1, { kind: 'system', text: 'Plan approved by Kyle · moved to Implementing', ...lead }),
        itemEvent(2, { kind: 'tool', rowId: 'r1', toolUseIds: ['r1'], tool: 'edit', label: 'Edit', detail: 'Pages/Jobs/JobControl.razor', stats: '+214 −0', ...lead }),
        itemEvent(3, { kind: 'text', streamId: 'm1', text: 'Cutting over **frmJobFilter** with the parent.', ...lead }),
        itemEvent(4, { kind: 'text-delta', streamId: 'm2', text: 'Wiring the job grid filters to JobFilterState', ...lead }),
      ]),
    );

    expect(screen.getByTestId('output-system').textContent).toMatch(/^\d\d:\d\d · Plan approved by Kyle · moved to Implementing$/);
    const toolRow = screen.getByTestId('output-tool');
    expect(toolRow.textContent).toContain('Edit');
    expect(toolRow.textContent).toContain('Pages/Jobs/JobControl.razor');
    expect(toolRow.textContent).toContain('+214');
    expect(screen.getByText('frmJobFilter')).toBeTruthy();
    expect(screen.getByTestId('output-streaming').textContent).toBe('Wiring the job grid filters to JobFilterState▍');
    expect(screen.getByTestId('output-caret')).toBeTruthy();
    expect(screen.getByRole('log', { name: 'Agent output' })).toBeTruthy();
  });

  it('draws only rows near the view of 10,000 events, following the newest', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive(Array.from({ length: 10_000 }, (_, index) => textEvent(index + 1))));

    expect(screen.getByText('line 10000')).toBeTruthy();
    expect(screen.queryByText('line 1')).toBeNull();
    expect(screen.getAllByTestId('output-prose').length).toBeLessThan(80);
  });

  it('stops following when scrolled up, offers Jump to latest, and follows again from it', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive(Array.from({ length: 2_000 }, (_, index) => textEvent(index + 1))));
    expect(screen.queryByTestId('output-jump-latest')).toBeNull();

    act(() => scrollTo(0, 64_000));
    expect(screen.getByText('line 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeTruthy();

    // New output does not pull the view down while the user reads older output.
    act(() => store.receive([textEvent(2_001, 'newest line')]));
    expect(screen.queryByText('newest line')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
    expect(screen.getByText('newest line')).toBeTruthy();
    expect(screen.queryByTestId('output-jump-latest')).toBeNull();
  });

  it('follows again when scrolled back to the end', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive(Array.from({ length: 2_000 }, (_, index) => textEvent(index + 1))));
    act(() => scrollTo(0, 64_000));
    expect(screen.getByTestId('output-jump-latest')).toBeTruthy();
    act(() => scrollTo(63_600, 64_000));
    expect(screen.queryByTestId('output-jump-latest')).toBeNull();
  });

  it('shows a design ship as a timed system line (AL-197)', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    const at = new Date(2026, 9, 8, 14, 1).getTime();
    act(() => store.receive([fakeOutputEvent('71273', at, { seq: 1, item: { kind: 'system', text: 'Design v2 approved by Kyle · 2 artboards', ...lead } })]));
    expect(screen.getByTestId('output-system').textContent).toBe('14:01 · Design v2 approved by Kyle · 2 artboards');
  });

  it('lets the user select output text', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive([textEvent(1, 'copy me')]));
    const text = screen.getByText('copy me');
    expect(getComputedStyle(text).userSelect).not.toBe('none');
  });
});

describe('Markdown in the output (AL-255)', () => {
  const sample = [
    '## What changed',
    'One test fails: `JobGridTests.FiltersByDateRange` expects the end date to be *inclusive*.',
    '- `JobFilterState.To` is compared with < instead of <=',
    '- the old grid had the same bug',
    '```diff',
    '- .Where(j => j.Due < filter.To)',
    '+ .Where(j => j.Due <= filter.To)',
    '```',
    'See [the cutover notes](https://example.invalid/notes).',
  ].join('\n');

  it('draws headings, lists, a coloured code fence with Copy and a link, without raw markdown characters', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive([textEvent(1, sample)]));
    const prose = screen.getByTestId('output-prose');
    expect(within(prose).getByRole('heading', { name: 'What changed' })).toBeTruthy();
    expect(within(prose).getAllByRole('listitem')).toHaveLength(2);
    expect(within(prose).getByTestId('md-code').textContent).toContain('+ .Where(j => j.Due <= filter.To)');
    expect(within(prose).getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(within(prose).getByRole('link', { name: 'the cutover notes' })).toBeTruthy();
    expect(within(prose).getByRole('button', { name: 'Copy message' })).toBeTruthy();
    expect(prose.textContent).not.toContain('## ');
    expect(prose.textContent).not.toContain('```');
    expect(prose.textContent).not.toContain('](');
    expect(prose.textContent).not.toContain('*inclusive*');
  });

  it('copies a message as plain text and opens links in the browser', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive([textEvent(1, 'Keep **this** and [notes](https://example.invalid/n)')]));
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Keep this and notes'));
    fireEvent.click(screen.getByRole('link', { name: 'notes' }));
    expect(open).toHaveBeenCalledWith('https://example.invalid/n', '_blank', 'noopener');
    open.mockRestore();
  });

  it('renders the streaming line as markdown too, with the caret after the last block', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive([itemEvent(1, { kind: 'text-delta', streamId: 'live', text: 'Fixing it:\n```ts\nconst a = 1;', ...lead })]));
    const live = screen.getByTestId('output-streaming');
    expect(within(live).getByTestId('md-code').textContent).toContain('const a = 1;▍');
  });
});

describe('expandable tool rows (AL-256)', () => {
  const toolItem = (overrides: Partial<Extract<AgentOutputItem, { kind: 'tool' }>>): AgentOutputItem => ({
    kind: 'tool',
    rowId: 'b1',
    toolUseIds: ['b1'],
    tool: 'bash',
    label: 'Bash',
    detail: 'dotnet test OnSite.Tests',
    stats: null,
    input: 'dotnet test OnSite.Tests --filter JobGrid\n# Run the grid tests',
    edit: null,
    ...lead,
    ...overrides,
  });
  const resultItem = (overrides: Partial<Extract<AgentOutputItem, { kind: 'tool-result' }>>): AgentOutputItem => ({
    kind: 'tool-result',
    rowId: 'b1',
    toolUseId: 'b1',
    isError: false,
    summary: 'Passed!',
    stats: null,
    output: 'Passed! - Failed: 0, Passed: 12',
    ...lead,
    ...overrides,
  });

  beforeEach(() => resetExpandedRows());

  it('opens a Bash row on click to its command and output, and closes it again', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive([itemEvent(1, toolItem({})), itemEvent(2, resultItem({}))]));
    expect(screen.queryByTestId('output-tool-body')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Bash dotnet test OnSite.Tests' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const body = screen.getByTestId('output-tool-body');
    expect(body.textContent).toContain('# Run the grid tests');
    expect(body.textContent).toContain('Passed: 12');
    expect(within(body).getByRole('button', { name: 'Copy output' })).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('output-tool-body')).toBeNull();
  });

  it('shows an Edit as a red and green diff', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() =>
      store.receive([
        itemEvent(1, toolItem({ rowId: 'e1', toolUseIds: ['e1'], tool: 'edit', label: 'Edit', detail: 'JobFilterState.cs', stats: '+1 −1', input: null, edit: { before: 'if (a < b)', after: 'if (a <= b)' } })),
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit JobFilterState.cs' }));
    const diff = screen.getByTestId('output-tool-diff');
    expect(diff.textContent).toContain('− if (a < b)');
    expect(diff.textContent).toContain('+ if (a <= b)');
  });

  it('shows a failed call’s reason while closed and keeps a row open across re-renders', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive([itemEvent(1, toolItem({})), itemEvent(2, resultItem({ isError: true, summary: 'Failed', output: 'Failed! JobGridTests.FiltersByDateRange\n  expected inclusive' }))]));
    expect(screen.getByTestId('output-tool-error').textContent).toContain('FiltersByDateRange');
    fireEvent.click(screen.getByRole('button', { name: 'Bash dotnet test OnSite.Tests' }));
    expect(screen.queryByTestId('output-tool-error')).toBeNull();
    expect(screen.getByTestId('output-tool-body').textContent).toContain('expected inclusive');
    act(() => store.receive([textEvent(3, 'next')]));
    expect(screen.getByTestId('output-tool-body')).toBeTruthy();
  });
});
