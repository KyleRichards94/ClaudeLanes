import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { defaultSettings } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { installFakeSettings } from '@/shared/testing';
import { settingsQueryKey, useSettings, useUpdateSettings } from './settings';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('settings queries', () => {
  it('useSettings loads the settings from the main process', async () => {
    installFakeSettings();
    const { wrapper } = setup();
    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(defaultSettings()));
  });

  it('useUpdateSettings saves a patch and puts the returned settings in the cache', async () => {
    const main = installFakeSettings();
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useUpdateSettings(), { wrapper });

    await act(() => result.current.mutateAsync({ defaults: { model: 'sonnet', effort: 'medium' } }));

    expect(main.updates).toEqual([{ defaults: { model: 'sonnet', effort: 'medium' } }]);
    expect(client.getQueryData(settingsQueryKey)).toEqual(main.settings);
    expect(main.settings.defaults).toMatchObject({ model: 'sonnet', effort: 'medium' });
  });

  it('useUpdateSettings surfaces a refused patch as an error', async () => {
    installFakeSettings();
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateSettings(), { wrapper });

    await expect(result.current.mutateAsync({ buildQueueSize: 0 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
