import type { AgentOutputItem } from '@agent-lanes/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeOutputEvent, installFakeBridge } from '@/shared/testing';
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

  it('lets the user select output text', () => {
    render(<OutputStream ticketId="71273" store={store} />);
    act(() => store.receive([textEvent(1, 'copy me')]));
    const text = screen.getByText('copy me');
    expect(getComputedStyle(text).userSelect).not.toBe('none');
  });
});
