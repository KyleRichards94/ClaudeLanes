import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { radius } from '@agent-lanes/tokens';
import { StatusBadge, badgeStatuses, statusLabel, type BadgeStatus } from './StatusBadge';

/** jsdom reports computed colours as rgb(); the artboard values below are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** WCAG 2 contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The "Status badges" block on artboard 6 (docs/design/screens/06-card-states.png), with the
 * colours sampled from the PNG's pixels: pill fill, solid text pixels and the dot's centre.
 * Each pill is 22 px tall with 8 px sides, a 6 px dot, a 6 px gap and a bold 12 px word.
 */
const artboard6: { status: BadgeStatus; word: string; band: string; text: string; dot: string | null }[] = [
  { status: 'running', word: 'Running', band: '#EEEBFF', text: '#4A3BB0', dot: '#5B4BC4' },
  { status: 'done', word: 'Done', band: '#D1FAE5', text: '#047857', dot: '#059669' },
  { status: 'queued', word: 'Queued', band: '#F1F5F9', text: '#475569', dot: '#94A3B8' },
  { status: 'needs-you', word: 'Needs you', band: '#FEF3C7', text: '#92400E', dot: '#D97706' },
  { status: 'switching', word: 'Switching · next turn', band: '#E0F2FE', text: '#0369A1', dot: null },
];

describe('StatusBadge', () => {
  it('has the five statuses of the artboard, in its order', () => {
    expect([...badgeStatuses]).toEqual(artboard6.map(({ status }) => status));
  });

  describe('every status pill carries a word, not only a colour', () => {
    it.each(badgeStatuses)('%s shows its fixed word as visible text', (status) => {
      render(<StatusBadge testID="badge" status={status} />);
      const badge = screen.getByTestId('badge');
      const word = statusLabel(status);
      expect(word).toMatch(/[A-Za-z]{4,}/);
      expect(within(badge).getByText(word)).toBeTruthy();
      // Nothing else is read: the dot is decorative.
      expect(badge.textContent).toBe(word);
      badge.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => expect(hidden.textContent).toBe(''));
    });

    it('gives each status a different word', () => {
      const words = badgeStatuses.map(statusLabel);
      expect(new Set(words).size).toBe(words.length);
    });

    it('keeps the words the design fixes', () => {
      expect(badgeStatuses.map(statusLabel)).toEqual(artboard6.map(({ word }) => word));
    });
  });

  describe.each(artboard6)('matches the artboard 6 status badge · $word', ({ status, word, band, text, dot }) => {
    it('has the sampled fill, text and dot colours', () => {
      render(<StatusBadge testID="badge" status={status} />);
      expect(getComputedStyle(screen.getByTestId('badge')).backgroundColor).toBe(rgb(band));
      expect(getComputedStyle(screen.getByText(word)).color).toBe(rgb(text));
      const dotElement = screen.queryByTestId('badge-dot');
      if (dot) {
        expect(dotElement).not.toBeNull();
        expect(getComputedStyle(dotElement as HTMLElement).backgroundColor).toBe(rgb(dot));
      } else {
        expect(dotElement).toBeNull();
      }
    });

    it('has the artboard box and type: 22 px pill, 8 px sides, bold 12 px', () => {
      render(<StatusBadge testID="badge" status={status} />);
      const box = getComputedStyle(screen.getByTestId('badge'));
      const label = getComputedStyle(screen.getByText(word));
      expect(box.borderTopLeftRadius).toBe(`${radius.pill}px`);
      expect(box.paddingLeft).toBe('8px');
      expect(box.paddingRight).toBe('8px');
      expect(parseFloat(box.paddingTop) + parseFloat(label.lineHeight) + parseFloat(box.paddingBottom)).toBe(22);
      expect(label.fontSize).toBe('12px');
      expect(label.fontWeight).toBe('700');
    });

    it('meets 4.5:1 for its word on its fill', () => {
      expect(contrast(text, band)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('takes the md size for header use', () => {
    render(<StatusBadge testID="badge" status="running" size="md" />);
    expect(getComputedStyle(screen.getByText('Running')).fontSize).toBe('14px');
  });
});
