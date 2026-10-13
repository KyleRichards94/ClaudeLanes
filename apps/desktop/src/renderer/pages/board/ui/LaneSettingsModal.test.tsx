import { defaultDropDefaults, defaultSettings } from '@agent-lanes/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installFakeSettings } from '@/shared/testing';
import { LaneSettingsModal } from './LaneSettingsModal';

vi.setConfig({ testTimeout: 15_000 });

function renderModal(lane: 'implementing' | 'comments-only') {
  const fake = installFakeSettings(defaultSettings());
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LaneSettingsModal lane={lane} visible onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fake, onClose };
}

const field = (testID: string) => screen.getByTestId(testID) as HTMLInputElement | HTMLTextAreaElement;

describe("a lane's settings button (skills and initial prompt for its drops)", () => {
  it('edits this lane’s row and saves it into Settings › Drops, leaving the other rows', async () => {
    const { fake, onClose } = renderModal('comments-only');
    const dialog = await screen.findByRole('dialog', { name: 'Resolve PR comments settings' });
    expect(field('lane-settings-comments-only-comments-only-skills').value).toBe('/pr-comment-actioner');

    fireEvent.change(field('lane-settings-comments-only-comments-only-prompt'), { target: { value: 'Reply in plain English and keep commits small.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.updates).toEqual([
      {
        dropDefaults: {
          ...defaultDropDefaults(),
          'comments-only': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high', prompt: 'Reply in plain English and keep commits small.' },
        },
      },
    ]);
  });

  it('shows both of Implementing’s rows, and blocks Save on a bad skill name', async () => {
    renderModal('implementing');
    const dialog = await screen.findByRole('dialog', { name: 'Implementing settings' });
    expect(screen.getByTestId('lane-settings-implementing-implementing')).toBeTruthy();
    expect(screen.getByTestId('lane-settings-implementing-answer-comments')).toBeTruthy();
    fireEvent.change(field('lane-settings-implementing-implementing-skills'), { target: { value: '/plan it!' } });
    expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  });
});
