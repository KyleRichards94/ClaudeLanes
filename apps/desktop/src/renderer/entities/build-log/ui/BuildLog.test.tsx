import type { BuildLogEvent, BuildLogLevel } from '@agent-lanes/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildLogStore, type BuildLogStore } from '../model/store';
import { BuildLog } from './BuildLog';
import { LOG_OVERSCAN, LOG_ROW_HEIGHT, visibleRange } from './VirtualLog';

function batch(lines: [string, BuildLogLevel?][], jobId = 'job-1'): BuildLogEvent {
  return {
    ticketId: '71273',
    at: Date.now(),
    jobId,
    kind: 'build',
    lines: lines.map(([text, level = 'info']) => ({ text, level, stream: 'stdout' })),
  };
}

/** A log of `count` lines with an error every `errorEvery` lines, sent in 500-line batches. */
function bigLog(store: BuildLogStore, count: number, errorEvery = 10_000) {
  for (let start = 0; start < count; start += 500) {
    const lines = Array.from({ length: Math.min(500, count - start) }, (_, i): [string, BuildLogLevel] => {
      const n = start + i;
      return [`line ${n}`, n > 0 && n % errorEvery === 0 ? 'error' : n % 1_000 === 1 ? 'warning' : 'info'];
    });
    store.append([batch(lines)]);
  }
}

function drawnRows() {
  return screen.queryAllByTestId(/^build-log-(info|warning|error|header)$/);
}

function scrollTo(top: number) {
  const node = screen.getByTestId('build-log-lines');
  node.scrollTop = top;
  fireEvent.scroll(node);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BuildLog', () => {
  it('says there is no output yet', () => {
    render(<BuildLog ticketId="71273" store={createBuildLogStore()} />);
    expect(screen.getByText(/No build output yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Next error/ })).toHaveProperty('disabled', true);
  });

  it('colours warnings and errors and counts them', () => {
    const store = createBuildLogStore();
    store.append([batch([['Build started.'], ['a.cs(1,1): warning CS0168', 'warning'], ['a.cs(2,1): error CS0246', 'error']])]);
    render(<BuildLog ticketId="71273" store={store} />);
    expect(screen.getByTestId('build-log-header').textContent).toMatch(/^Build · /);
    expect(screen.getByTestId('build-log-warning').textContent).toBe('a.cs(1,1): warning CS0168');
    expect(screen.getByTestId('build-log-error').textContent).toBe('a.cs(2,1): error CS0246');
    expect(screen.getByText('1 error')).toBeTruthy();
    expect(screen.getByText('1 warning')).toBeTruthy();
    expect(screen.getByText('4 lines')).toBeTruthy();
  });

  it('draws only the rows near the view of a 50,000-line log, at any scroll position', () => {
    const store = createBuildLogStore();
    bigLog(store, 50_000);
    render(<BuildLog ticketId="71273" store={store} />);

    // Follow is on: the tail is drawn.
    expect(screen.getByText('line 49999')).toBeTruthy();
    expect(drawnRows().length).toBeLessThan(100);

    act(() => scrollTo(25_000 * LOG_ROW_HEIGHT));
    expect(screen.getByText('line 24999')).toBeTruthy();
    expect(screen.queryByText('line 49999')).toBeNull();
    expect(drawnRows().length).toBeLessThan(100);
    // Scrolling up turned follow off.
    expect(screen.getByRole('switch', { name: 'Follow tail' }).getAttribute('aria-checked')).toBe('false');

    act(() => scrollTo(0));
    expect(screen.getByText('line 0')).toBeTruthy();
    expect(drawnRows().length).toBeLessThan(100);
  });

  it('jumps to the next error and wraps round', () => {
    const store = createBuildLogStore();
    bigLog(store, 50_000, 20_000);
    render(<BuildLog ticketId="71273" store={store} />);
    act(() => scrollTo(0));

    fireEvent.click(screen.getByRole('button', { name: /Next error/ }));
    expect(screen.getByText('line 20000')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Follow tail' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /Next error/ }));
    expect(screen.getByText('line 40000')).toBeTruthy();
    expect(screen.queryByText('line 20000')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Next error/ }));
    expect(screen.getByText('line 20000')).toBeTruthy();
  });

  it('follows new lines while Follow tail is on, and stays put while it is off', () => {
    const store = createBuildLogStore();
    bigLog(store, 2_000);
    render(<BuildLog ticketId="71273" store={store} />);
    act(() => store.append([batch([['fresh line']])]));
    expect(screen.getByText('fresh line')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Follow tail' }));
    act(() => scrollTo(0));
    act(() => store.append([batch([['later line']])]));
    expect(screen.queryByText('later line')).toBeNull();
    expect(screen.getByText('line 0')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Follow tail' }));
    expect(screen.getByText('later line')).toBeTruthy();
  });

  it('copies the whole log, not just the drawn rows', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const store = createBuildLogStore();
    bigLog(store, 1_000);
    render(<BuildLog ticketId="71273" store={store} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Copied/ })).toBeTruthy());
    const text = writeText.mock.calls[0]![0] as string;
    expect(text.split('\n')).toHaveLength(1_001);
    expect(text).toContain('line 0\n');
    expect(text.endsWith('line 999')).toBe(true);
  });
});

describe('visibleRange', () => {
  it('covers the view plus the overscan, clamped to the log', () => {
    expect(visibleRange(50_000, 0, 400)).toEqual({ start: 0, end: 20 + LOG_OVERSCAN });
    expect(visibleRange(50_000, 1_000 * LOG_ROW_HEIGHT, 400)).toEqual({ start: 1_000 - LOG_OVERSCAN, end: 1_020 + LOG_OVERSCAN });
    expect(visibleRange(10, 0, 400)).toEqual({ start: 0, end: 10 });
  });
});
