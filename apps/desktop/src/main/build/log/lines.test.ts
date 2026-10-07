import { BUILD_LOG_LINE_MAX } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampLine, createBatcher, createLineSplitter } from './lines';

function split(chunks: (string | Buffer)[]): string[] {
  const lines: string[] = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  for (const chunk of chunks) splitter.write(chunk);
  splitter.end();
  return lines;
}

describe('createLineSplitter', () => {
  it('splits on \\n, \\r\\n and a lone \\r, across chunk boundaries', () => {
    expect(split(['one\r\ntw', 'o\nthree\r', '\nfour\rfive'])).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('joins a UTF-8 character split across two chunks', () => {
    const bytes = Buffer.from('café ✓\n', 'utf8');
    expect(split([bytes.subarray(0, 4), bytes.subarray(4, 7), bytes.subarray(7)])).toEqual(['café ✓']);
  });

  it('keeps empty lines and lets a huge line without breaks out in pieces', () => {
    expect(split(['a\n\nb\n'])).toEqual(['a', '', 'b']);
    const lines = split(['x'.repeat(200_000)]);
    expect(lines.join('')).toHaveLength(200_000);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('clampLine', () => {
  it('cuts long lines with an ellipsis', () => {
    expect(clampLine('short')).toBe('short');
    const clamped = clampLine('y'.repeat(BUILD_LOG_LINE_MAX + 10));
    expect(clamped).toHaveLength(BUILD_LOG_LINE_MAX);
    expect(clamped.endsWith('…')).toBe(true);
  });
});

describe('createBatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends lines in batches after the interval, or at once when a batch is full', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const batcher = createBatcher<number>({ send, intervalMs: 100, maxItems: 3 });

    batcher.push(1);
    batcher.push(2);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenLastCalledWith([1, 2]);

    batcher.push(3);
    batcher.push(4);
    batcher.push(5);
    expect(send).toHaveBeenLastCalledWith([3, 4, 5]);
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(2);

    batcher.push(6);
    batcher.flush();
    expect(send).toHaveBeenLastCalledWith([6]);
    batcher.flush();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('turns 10,000 lines a second into about ten events', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const batcher = createBatcher<number>({ send });
    for (let ms = 0; ms < 1000; ms += 1) {
      for (let i = 0; i < 10; i += 1) batcher.push(ms * 10 + i);
      vi.advanceTimersByTime(1);
    }
    batcher.flush();
    expect(send.mock.calls.length).toBeLessThanOrEqual(21);
    expect(send.mock.calls.flatMap((call) => call[0] as number[])).toHaveLength(10_000);
  });
});
