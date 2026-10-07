import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { color, control, fontSize, fontWeight, glass, radius, shadow, tone } from '@agent-lanes/tokens';
import { Toast, toastTones, toastWidth, type ToastTone } from './Toast';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
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

/** The visible surface inside a Button's pressable target. */
function surfaceOf(button: HTMLElement): HTMLElement {
  const surface = button.firstElementChild;
  if (!(surface instanceof HTMLElement)) throw new Error('button has no surface');
  return surface;
}

/** The icon tile: the element right around the toast's svg. */
function tileOf(region: HTMLElement): HTMLElement {
  const tile = region.querySelector('svg')?.parentElement;
  if (!tile) throw new Error('toast has no icon tile');
  return tile;
}

/** Icon tile per tone: band behind, strong colour on top, and the word a screen reader hears. */
const tiles: Record<ToastTone, { band: string; ink: string; word: string; role: 'alert' | 'status'; live: string }> = {
  info: { band: tone.ado.band, ink: tone.ado.dot, word: 'Info', role: 'status', live: 'polite' },
  success: { band: tone.ok.band, ink: tone.ok.dot, word: 'Success', role: 'status', live: 'polite' },
  warning: { band: tone.attention.band, ink: tone.attention.text, word: 'Warning', role: 'status', live: 'polite' },
  error: { band: tone.danger.band, ink: tone.danger.dot, word: 'Error', role: 'alert', live: 'assertive' },
};

describe('Toast', () => {
  it('has the four tones of the toast event', () => {
    expect([...toastTones]).toEqual(['info', 'success', 'warning', 'error']);
  });

  describe('matches artboard 6 "Toast · error"', () => {
    it('lays out a 450 px glass card with the red icon tile, bold title, muted body, Reconnect and Dismiss', () => {
      render(
        <Toast
          testID="toast"
          tone="error"
          title="MCP bridge lost the session"
          body="cc-71288 stopped responding. The worktree is intact."
          actions={[{ label: 'Reconnect', onPress: vi.fn() }]}
          onDismiss={vi.fn()}
        />,
      );

      const panel = getComputedStyle(screen.getByTestId('toast'));
      expect(panel.width).toBe(`${toastWidth}px`);
      expect(toastWidth).toBe(450);
      expect(panel.borderTopLeftRadius).toBe(`${radius.card}px`);
      expect(panel.paddingTop).toBe('14px');
      expect(panel.paddingLeft).toBe('16px');
      expect(panel.backgroundColor).toBe(glass.fillMax.replace(/\s/g, '').replace(/,/g, ', '));
      expect(panel.boxShadow).toBe(`${glass.highlight}, ${shadow.card}`);

      const alert = screen.getByRole('alert');
      const tile = getComputedStyle(tileOf(alert));
      expect(tile.width).toBe('32px');
      expect(tile.height).toBe('32px');
      expect(tile.borderTopLeftRadius).toBe(`${radius.chip}px`);
      expect(tile.backgroundColor).toBe(rgb(tone.danger.band));
      expect(alert.querySelector('svg')?.getAttribute('stroke')).toBe(color.danger);

      const title = getComputedStyle(screen.getByText('MCP bridge lost the session'));
      expect(title.fontWeight).toBe(fontWeight.heading);
      expect(title.fontSize).toBe(`${fontSize.md}px`);
      expect(title.color).toBe(rgb(color.ink));
      const body = getComputedStyle(screen.getByText('cc-71288 stopped responding. The worktree is intact.'));
      expect(body.color).toBe(rgb(color.muted));
      expect(body.fontSize).toBe(`${fontSize.md}px`);

      const reconnect = screen.getByRole('button', { name: 'Reconnect' });
      const dismiss = screen.getByRole('button', { name: 'Dismiss' });
      expect(getComputedStyle(surfaceOf(reconnect)).backgroundColor).toBe(rgb(color.claude));
      expect(getComputedStyle(surfaceOf(reconnect)).minHeight).toBe('38px');
      expect(getComputedStyle(surfaceOf(dismiss)).backgroundColor).toBe(rgb(color.surface));
      expect(getComputedStyle(screen.getByText('Dismiss')).color).toBe(rgb(control.ink));
      // Reconnect comes first, then Dismiss.
      expect(reconnect.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    });
  });

  describe.each(toastTones)('%s tone', (toneName) => {
    const want = tiles[toneName];

    it(`is a ${want.role} region read ${want.live}ly, named by the word for its tone`, () => {
      render(<Toast tone={toneName} title="Saved connections" />);
      const region = screen.getByRole(want.role);
      expect(region.getAttribute('aria-live')).toBe(want.live);
      expect(within(region).getByRole('img', { name: want.word })).toBeTruthy();
      expect(within(region).getByText('Saved connections')).toBeTruthy();
    });

    it('draws its tile in the tone band with the icon in the tone colour', () => {
      render(<Toast tone={toneName} title="x" />);
      const region = screen.getByRole(want.role);
      expect(getComputedStyle(tileOf(region)).backgroundColor).toBe(rgb(want.band));
      expect(region.querySelector('svg')?.getAttribute('stroke')).toBe(want.ink);
    });

    it('keeps its icon at 3:1 or more on its tile', () => {
      expect(contrast(want.ink, want.band)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('actions', () => {
    it('makes the first action primary and the rest secondary, and calls each on press', async () => {
      const user = userEvent.setup();
      const openTicket = vi.fn();
      const openBoard = vi.fn();
      const dismiss = vi.fn();
      render(
        <Toast
          tone="warning"
          title="Build queue is full"
          actions={[
            { label: 'Open ticket', onPress: openTicket },
            { label: 'Board', onPress: openBoard },
          ]}
          onDismiss={dismiss}
        />,
      );

      expect(getComputedStyle(surfaceOf(screen.getByRole('button', { name: 'Open ticket' }))).backgroundColor).toBe(rgb(color.claude));
      expect(getComputedStyle(surfaceOf(screen.getByRole('button', { name: 'Board' }))).backgroundColor).toBe(rgb(color.surface));

      await user.click(screen.getByRole('button', { name: 'Open ticket' }));
      await user.click(screen.getByRole('button', { name: 'Board' }));
      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(openTicket).toHaveBeenCalledOnce();
      expect(openBoard).toHaveBeenCalledOnce();
      expect(dismiss).toHaveBeenCalledOnce();
    });

    it('reaches every button with Tab, actions before Dismiss, and never takes focus by itself', async () => {
      const user = userEvent.setup();
      render(<Toast tone="error" title="x" actions={[{ label: 'Reconnect', onPress: vi.fn() }]} onDismiss={vi.fn()} />);
      expect(document.activeElement).toBe(document.body);

      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reconnect' }));
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }));
    });

    it('shows no buttons without actions or onDismiss, and only Dismiss with just onDismiss', () => {
      const { rerender } = render(<Toast tone="info" title="Saved" />);
      expect(screen.queryAllByRole('button')).toHaveLength(0);

      rerender(<Toast tone="info" title="Saved" onDismiss={vi.fn()} />);
      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Dismiss']);
    });
  });

  it('lets the user select the body to copy it, but not the title', () => {
    render(<Toast tone="error" title="Build failed" body="CS0246: JobFilterState not found" />);
    expect(getComputedStyle(screen.getByText('CS0246: JobFilterState not found')).userSelect).toBe('text');
    expect(getComputedStyle(screen.getByText('Build failed')).userSelect).toBe('none');
  });
});
