import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useUiPrefs } from '@/shared/model';
import { installFakeSettings } from '@/shared/testing';
import { AppearanceSync } from './AppearanceSync';

describe('AppearanceSync', () => {
  afterEach(() => {
    act(() => {
      useUiPrefs.setState({ appearance: 'system' });
    });
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = '';
  });

  it('follows the computer for System: light where jsdom has no matchMedia', () => {
    installFakeSettings();
    render(<AppearanceSync />);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it('puts a picked theme on the document with its light or dark base', () => {
    installFakeSettings();
    render(<AppearanceSync />);

    // Block bodies: the persist store's set returns its save promise, which act would treat as async.
    act(() => {
      useUiPrefs.getState().setAppearance('solarpunk');
    });
    expect(document.documentElement.dataset.theme).toBe('solarpunk');
    expect(document.documentElement.style.colorScheme).toBe('light');

    act(() => {
      useUiPrefs.getState().setAppearance('dark');
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
