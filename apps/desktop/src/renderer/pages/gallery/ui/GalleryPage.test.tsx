import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { color } from '@agent-lanes/tokens';
import * as ui from '@agent-lanes/ui';
import { badgeStatuses, buttonVariants, iconNames, pillTones, statusLabel, textVariants } from '@agent-lanes/ui';
import { RouterProvider, createRouter, routes, selectRoute } from '@/shared/routing';
import { cardStates } from './CardStatesSheet';
import { GalleryPage } from './GalleryPage';
import cardStatesSource from './CardStatesSheet.tsx?raw';
import pageSource from './GalleryPage.tsx?raw';
import primitivesSource from './PrimitivesSheet.tsx?raw';
import tokensSource from './TokensSheet.tsx?raw';

function renderGallery() {
  const router = createRouter(routes.gallery());
  render(
    <RouterProvider router={router}>
      <GalleryPage />
    </RouterProvider>,
  );
  return router;
}

/** The gallery's own source, to check that every primitive is used in it. */
const gallerySource = [pageSource, tokensSource, cardStatesSource, primitivesSource].join('\n');

/** React components exported by `packages/ui` (capitalised function exports). */
const primitives = Object.entries(ui)
  .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === 'function')
  .map(([name]) => name);

describe('GalleryPage (AL-032)', () => {
  it('renders every primitive packages/ui exports', () => {
    expect(primitives.length).toBeGreaterThan(15);
    for (const name of primitives) {
      expect(gallerySource, `${name} is not in the gallery`).toMatch(new RegExp(`<${name}[\\s>/]`));
    }
  });

  it('shows the tokens sheet: every colour token, the three glass levels, type and buttons (artboard 7)', () => {
    renderGallery();
    const sheet = within(screen.getByTestId('gallery-tokens'));

    expect(sheet.getByRole('heading', { name: 'Design tokens' })).toBeTruthy();
    for (const [token, value] of Object.entries(color)) {
      expect(screen.getByTestId(`gallery-swatch-${token}`).textContent).toContain(value);
    }
    for (const level of ['sm', 'md', 'xl']) {
      expect(sheet.getByTestId(`gallery-glass-${level}`).textContent).toContain(`--blur-${level}`);
    }
    expect(sheet.getByText('Plus Jakarta Sans 800')).toBeTruthy();
    expect(sheet.getByText('JetBrains Mono 400 — IDs, branches, logs, diffs')).toBeTruthy();
    for (const label of ['Primary', 'Strong', 'Secondary', 'Soft pill']) {
      expect(sheet.getByRole('button', { name: label })).toBeTruthy();
    }
    for (const radius of ['8 · chip', '12 · control', '16 · card', '20 · panel', '28 · modal']) {
      expect(sheet.getByText(radius)).toBeTruthy();
    }
  });

  it('shows every card state on artboard 6, the empty lane, the error toast and the status badges', () => {
    renderGallery();
    const sheet = within(screen.getByTestId('gallery-card-states'));

    expect(cardStates.map((card) => card.state)).toEqual([
      'Running',
      'Selected',
      'Needs approval',
      'Model switching',
      'Build failed',
      'QA gap',
      'PR open',
      'Merged',
    ]);
    for (const card of cardStates) {
      expect(sheet.getByRole('heading', { name: card.state })).toBeTruthy();
      const sample = within(sheet.getByTestId(`gallery-card-${card.state.toLowerCase().replace(/\s+/g, '-')}`));
      expect(sample.getByText(card.activity)).toBeTruthy();
      if (card.footer) expect(sample.getByText(card.footer.label as string)).toBeTruthy();
    }
    expect(sheet.getByText('Nothing in QA')).toBeTruthy();
    expect(within(sheet.getByTestId('gallery-toast-error')).getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    for (const status of badgeStatuses) expect(sheet.getAllByText(statusLabel(status)).length).toBeGreaterThan(0);
  });

  it('lists each variant: text, buttons, pill tones and icons', () => {
    renderGallery();
    const sheet = within(screen.getByTestId('gallery-primitives'));

    for (const variant of textVariants) expect(sheet.getByText(variant)).toBeTruthy();
    expect(sheet.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    expect(buttonVariants).toContain('danger');
    for (const pillTone of pillTones) expect(sheet.getByText(pillTone)).toBeTruthy();
    for (const name of iconNames) expect(sheet.getByText(name)).toBeTruthy();
  });

  it('opens the normal and the blocking modal', () => {
    renderGallery();

    fireEvent.click(screen.getByTestId('gallery-open-modal'));
    const dialog = screen.getByRole('dialog', { name: 'Connections' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Connections' })).toBeNull();

    fireEvent.click(screen.getByTestId('gallery-open-blocking-modal'));
    const blocking = screen.getByRole('dialog', { name: 'Connect Agent Lanes' });
    expect(within(blocking).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(within(blocking).getByRole('button', { name: 'Finish' }));
    expect(screen.queryByRole('dialog', { name: 'Connect Agent Lanes' })).toBeNull();
  });

  it('goes back to the board', () => {
    const router = renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(selectRoute(router.getState())).toEqual(routes.board());
  });
});
