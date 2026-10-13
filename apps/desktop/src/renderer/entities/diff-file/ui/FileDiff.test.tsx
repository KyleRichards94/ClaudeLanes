import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { GitDiffFileRequest } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import type { DiffView } from '@/shared/model';
import { FileDiff } from './FileDiff';

const patch = '@@ -1,2 +1,2 @@\n Imports System\n-Public Class A\n+Public Class B\n';

function setup(props: { view?: DiffView; stripeColor?: string; onViewChange?: (view: DiffView) => void } = {}) {
  const bridge = installFakeBridge();
  bridge.invoke = vi.fn(async (_channel: string, request: unknown) => ({ ok: true, data: { kind: 'text', path: (request as GitDiffFileRequest).path, patch } })) as typeof bridge.invoke;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FileDiff ticketId="71273" path="src/A.cs" view={props.view ?? 'unified'} {...(props.stripeColor ? { stripeColor: props.stripeColor } : {})} {...(props.onViewChange ? { onViewChange: props.onViewChange } : {})} />
    </QueryClientProvider>,
  );
}

describe('FileDiff (AL-276)', () => {
  it('draws the unified lines of one file with no stripe by default', async () => {
    setup();
    expect(await screen.findByTestId('diff-line-add')).toBeTruthy();
    expect(screen.getByTestId('diff-line-add').style.borderLeftWidth).toBe('');
  });

  it('puts the author’s 4 px stripe on added and removed lines, and keeps an empty gap on the others', async () => {
    setup({ stripeColor: '#0369A1' });
    const add = await screen.findByTestId('diff-line-add');
    expect(add.style.borderLeftWidth).toBe('4px');
    expect(add.style.borderLeftColor).toBe('rgb(3, 105, 161)');
    expect(screen.getByTestId('diff-line-remove').style.borderLeftColor).toBe('rgb(3, 105, 161)');
    const context = screen.getByTestId('diff-line-context');
    expect(context.style.borderLeftWidth).toBe('4px');
    expect(context.style.borderLeftColor).toBe('rgba(0, 0, 0, 0)');
  });

  it('stripes both halves of a side-by-side row', async () => {
    setup({ view: 'split', stripeColor: '#DB2777' });
    expect((await screen.findByTestId('diff-split-new-add')).style.borderLeftColor).toBe('rgb(219, 39, 119)');
    expect(screen.getByTestId('diff-split-old-remove').style.borderLeftColor).toBe('rgb(219, 39, 119)');
  });

  it('offers a Unified / Side by side switch when a layout has none of its own', async () => {
    const onViewChange = vi.fn();
    setup({ onViewChange });
    await screen.findByTestId('diff-line-add');
    fireEvent.click(screen.getByRole('radio', { name: 'Side by side' }));
    expect(onViewChange).toHaveBeenCalledWith('split');
  });
});
