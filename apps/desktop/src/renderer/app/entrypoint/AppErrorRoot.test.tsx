import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { AppErrorRoot } from './AppErrorRoot';

function Broken(): never {
  throw new Error('board failed to render');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppErrorRoot', () => {
  it('replaces a crashed app with the fallback and logs it as the app boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bridge = installFakeBridge({ 'app:logError': { ok: true, data: null } });

    render(
      <AppErrorRoot>
        <Broken />
      </AppErrorRoot>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong in Agent Lanes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeTruthy();
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('app:logError', expect.objectContaining({ boundary: 'app', message: 'board failed to render' })),
    );
  });
});
