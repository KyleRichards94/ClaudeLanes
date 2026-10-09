import { act, render, screen } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputStream, agentOutput } from '@/entities/agent-output';
import { fakeOutputEvent, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { startEventHub, stopEventHub } from './EventHub';

/**
 * AL-175 acceptance, the part a unit test can show: 10,000 events streamed through the real path
 * (fake bridge → the app's event hub → `agentOutputEventHandlers` → the output store → OutputStream)
 * reach the store at most once per animation frame and re-render the stream at most once per frame,
 * drawing only the rows near the view. Scrolling at 60 fps in Chromium is measured by
 * `e2e/output-stream.spec.ts`.
 */

// Counts commits, not wall time: under a full parallel run it has taken over the default 5 s (AL-220).
vi.setConfig({ testTimeout: 30_000 });

let bridge: FakeBridge;
let commits = 0;
const onRender: ProfilerOnRenderCallback = (_id, phase) => {
  if (phase !== 'mount') commits += 1;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  bridge = installFakeBridge();
  startEventHub();
});

afterEach(() => {
  stopEventHub();
  agentOutput.forget('71273');
  vi.useRealTimers();
});

describe('output stream under load (AL-175)', () => {
  it('commits the store and re-renders the stream at most once per frame for 10,000 events', async () => {
    render(
      <Profiler id="output" onRender={onRender}>
        <OutputStream ticketId="71273" />
      </Profiler>,
    );
    // Let the backfill request settle (the fake bridge has no transcript; live output still shows).
    await act(async () => {
      await Promise.resolve();
    });
    commits = 0;
    let storeCommits = 0;
    const unsubscribe = agentOutput.subscribe(() => {
      storeCommits += 1;
    });

    const frames = 40;
    let seq = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let i = 0; i < 250; i += 1) {
        seq += 1;
        bridge.emit('agent:output', fakeOutputEvent('71273', seq));
      }
      act(() => {
        vi.advanceTimersToNextFrame();
      });
    }
    unsubscribe();

    expect(seq).toBe(10_000);
    expect(storeCommits).toBeLessThanOrEqual(frames);
    expect(commits).toBeLessThanOrEqual(frames);
    expect(screen.getByText('line 10000')).toBeTruthy();
    expect(screen.getAllByTestId('output-prose').length).toBeLessThan(80);
  });
});
