import type { BuildLogEvent, BuildLogLevel } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { appendBuildLog, buildLogText, EMPTY_BUILD_LOG, jobHeader, nextErrorRow } from './log';
import { createBuildLogStore, selectBuildLog } from './store';

const AT = new Date(2026, 9, 7, 14, 2, 5).getTime();

function batch(lines: [string, BuildLogLevel?][], overrides: Partial<BuildLogEvent> = {}): BuildLogEvent {
  return {
    ticketId: '71273',
    at: AT,
    jobId: 'job-1',
    kind: 'build',
    lines: lines.map(([text, level = 'info']) => ({ text, level, stream: 'stdout' })),
    ...overrides,
  };
}

describe('appendBuildLog', () => {
  it('starts each job with a header row and keeps lines in order', () => {
    const log = appendBuildLog(EMPTY_BUILD_LOG, [
      batch([['Build started.'], ['a.cs(1,1): warning CS0168: x', 'warning']]),
      batch([['a.cs(2,1): error CS0246: y', 'error']]),
      batch([['Now listening on: http://localhost:5080']], { jobId: 'run-1', kind: 'run' }),
    ]);
    expect(log.rows.map((row) => [row.level, row.text])).toEqual([
      ['header', 'Build · 14:02:05'],
      ['info', 'Build started.'],
      ['warning', 'a.cs(1,1): warning CS0168: x'],
      ['error', 'a.cs(2,1): error CS0246: y'],
      ['header', 'Run · 14:02:05'],
      ['info', 'Now listening on: http://localhost:5080'],
    ]);
    expect(log.errorRows).toEqual([3]);
    expect(log.warnings).toBe(1);
    expect(new Set(log.rows.map((row) => row.id)).size).toBe(log.rows.length);
  });

  it('adds to an existing log without a second header for the same job', () => {
    const first = appendBuildLog(EMPTY_BUILD_LOG, [batch([['one', 'error']])]);
    const second = appendBuildLog(first, [batch([['two', 'error']])]);
    expect(second.rows.map((row) => row.text)).toEqual(['Build · 14:02:05', 'one', 'two']);
    expect(second.errorRows).toEqual([1, 2]);
    expect(first.rows).toHaveLength(2);
  });

  it('drops the oldest rows over the cap and recounts errors and warnings', () => {
    const log = appendBuildLog(
      EMPTY_BUILD_LOG,
      [batch([['w', 'warning'], ['e1', 'error'], ['i'], ['e2', 'error'], ['w2', 'warning']])],
      4,
    );
    expect(log.rows.map((row) => row.text)).toEqual(['e1', 'i', 'e2', 'w2']);
    expect(log.errorRows).toEqual([0, 2]);
    expect(log.warnings).toBe(1);
    expect(log.dropped).toBe(2);
  });

  it('returns the same log for no events', () => {
    expect(appendBuildLog(EMPTY_BUILD_LOG, [])).toBe(EMPTY_BUILD_LOG);
  });
});

describe('nextErrorRow', () => {
  it('goes to the next error after a row and wraps round', () => {
    const log = { errorRows: [3, 10, 40] };
    expect(nextErrorRow(log, -1)).toBe(3);
    expect(nextErrorRow(log, 3)).toBe(10);
    expect(nextErrorRow(log, 39)).toBe(40);
    expect(nextErrorRow(log, 40)).toBe(3);
    expect(nextErrorRow({ errorRows: [] }, 0)).toBeNull();
  });
});

describe('buildLogText', () => {
  it('joins every row, header rows marked', () => {
    const log = appendBuildLog(EMPTY_BUILD_LOG, [batch([['a'], ['b', 'error']])]);
    expect(buildLogText(log)).toBe(`── ${jobHeader('build', AT)} ──\na\nb`);
  });
});

describe('build log store', () => {
  it("keeps each ticket's log apart and replaces only the ticket that got lines", () => {
    const store = createBuildLogStore();
    store.append([batch([['a']]), batch([['b']], { ticketId: '9001' })]);
    const other = selectBuildLog(store.getState(), '9001');
    store.append([batch([['c']])]);
    expect(selectBuildLog(store.getState(), '71273').rows.map((row) => row.text)).toEqual(['Build · 14:02:05', 'a', 'c']);
    expect(selectBuildLog(store.getState(), '9001')).toBe(other);
    store.clear('71273');
    expect(selectBuildLog(store.getState(), '71273')).toBe(EMPTY_BUILD_LOG);
  });

  it('takes 50,000 lines in 100 batches quickly', () => {
    const store = createBuildLogStore();
    const started = performance.now();
    for (let frame = 0; frame < 100; frame++) {
      const lines = Array.from({ length: 500 }, (_, i): [string, BuildLogLevel] => [`line ${frame * 500 + i}`, i % 97 === 0 ? 'error' : 'info']);
      store.append([batch(lines)]);
    }
    const log = selectBuildLog(store.getState(), '71273');
    expect(log.rows).toHaveLength(50_001);
    expect(log.errorRows.length).toBe(100 * 6);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
