import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { color, control, focusRing, fontSize, fontWeight, minTarget, motion, radius, shadow, tone } from '@agent-lanes/tokens';
import { Button, buttonSizes, buttonVariants, type ButtonVariant } from './Button';

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

/**
 * The button row on the "Design tokens" artboard (docs/design/screens/07-design-tokens.png),
 * sampled from the image: 44 px tall, 12 px corners (the soft one a pill), 18 px sides, bold 14 px
 * labels, secondary label in slate #334155; only the primary button casts its violet glow at rest.
 * Plus `danger`, the red-bordered Remove button on the Connections artboard.
 */
const artboard: Record<ButtonVariant, { label: string; fill: string; border: string; ink: string; corner: number; rest: string }> = {
  primary: { label: 'Primary', fill: color.claude, border: color.claude, ink: color.surface, corner: radius.control, rest: control.primaryShadow },
  strong: { label: 'Strong', fill: color.ink, border: color.ink, ink: color.surface, corner: radius.control, rest: 'none' },
  secondary: { label: 'Secondary', fill: color.surface, border: color.line, ink: '#334155', corner: radius.control, rest: 'none' },
  soft: { label: 'Soft pill', fill: color.claudeTint, border: color.claudeTint, ink: color.claudeText, corner: radius.pill, rest: 'none' },
  danger: { label: 'Remove', fill: color.surface, border: tone.danger.border, ink: color.danger, corner: radius.control, rest: 'none' },
};

/** The visible surface inside the pressable target. */
function surfaceOf(button: HTMLElement): HTMLElement {
  const surface = button.firstElementChild;
  if (!(surface instanceof HTMLElement)) throw new Error('button has no surface');
  return surface;
}

/** Not lifted and not darkened (jsdom reports an unset transform or filter as '' or 'none'). */
function expectAtRest(surface: HTMLElement) {
  const style = getComputedStyle(surface);
  expect(['', 'none']).toContain(style.transform);
  expect(['', 'none']).toContain(style.filter);
}

function setup(ui: ReactElement) {
  const user = userEvent.setup();
  return { user, ...render(ui) };
}

describe('Button', () => {
  it('has the four artboard variants plus danger, in two sizes', () => {
    expect([...buttonVariants]).toEqual(['primary', 'strong', 'secondary', 'soft', 'danger']);
    expect([...buttonSizes]).toEqual(['sm', 'md']);
  });

  describe('variants match artboard 7', () => {
    it.each(buttonVariants)('%s', (variant) => {
      const want = artboard[variant];
      render(<Button variant={variant} label={want.label} />);
      const button = screen.getByRole('button', { name: want.label });
      const surface = getComputedStyle(surfaceOf(button));

      expect(surface.backgroundColor).toBe(rgb(want.fill));
      expect(surface.borderTopColor).toBe(rgb(want.border));
      expect(surface.borderTopWidth).toBe('1px');
      expect(surface.borderTopLeftRadius).toBe(`${want.corner}px`);
      expect(surface.minHeight).toBe('44px');
      expect(surface.paddingLeft).toBe('18px');
      expect(surface.paddingRight).toBe('18px');
      expect(surface.boxShadow).toBe(want.rest);
      expectAtRest(surfaceOf(button));

      const label = getComputedStyle(screen.getByText(want.label));
      expect(label.color).toBe(rgb(want.ink));
      expect(label.fontWeight).toBe(fontWeight.heading);
      expect(label.fontSize).toBe(`${fontSize.md}px`);
    });

    it.each(buttonVariants)('%s label meets 4.5:1 on its fill', (variant) => {
      const { ink, fill } = artboard[variant];
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5);
    });

    it('is secondary when no variant is given', () => {
      render(<Button label="Cancel" />);
      expect(getComputedStyle(surfaceOf(screen.getByRole('button'))).backgroundColor).toBe(rgb(color.surface));
      expect(getComputedStyle(screen.getByText('Cancel')).color).toBe(rgb(control.ink));
    });

    it('renders a native button, so the platform handles activation and disabled state', () => {
      render(<Button label="Cancel" />);
      const button = screen.getByRole('button', { name: 'Cancel' });
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    });
  });

  describe('sizes and targets', () => {
    it('keeps the target at least 44 px while the sm surface is 38 px', () => {
      render(<Button size="sm" variant="danger" label="Remove" />);
      const button = screen.getByRole('button', { name: 'Remove' });
      expect(getComputedStyle(button).minHeight).toBe(`${minTarget}px`);
      expect(getComputedStyle(button).minWidth).toBe(`${minTarget}px`);

      const surface = getComputedStyle(surfaceOf(button));
      expect(surface.minHeight).toBe('38px');
      expect(surface.paddingLeft).toBe('14px');
      expect(getComputedStyle(screen.getByText('Remove')).fontSize).toBe(`${fontSize.sm}px`);
    });

    it('draws an icon-only button as a 44 px square named by its label', () => {
      render(<Button iconOnly icon="link" label="Connections" />);
      const button = screen.getByRole('button', { name: 'Connections' });
      expect(screen.queryByText('Connections')).toBeNull();
      const surface = getComputedStyle(surfaceOf(button));
      expect(surface.width).toBe('44px');
      expect(surface.minHeight).toBe('44px');
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('needs an icon to be icon-only (checked by tsc)', () => {
      // @ts-expect-error An icon-only button must name its icon.
      const iconless = <Button iconOnly label="Connections" />;
      expect(iconless.props.label).toBe('Connections');
    });
  });

  describe('icons', () => {
    it('puts the leading icon before the label in the label colour and 16 px', () => {
      render(<Button variant="primary" icon="plus" label="New agent ticket" />);
      const button = screen.getByRole('button', { name: 'New agent ticket' });
      const svg = button.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('stroke')).toBe(color.surface);
      expect(svg?.getAttribute('width')).toBe('16');
      const label = screen.getByText('New agent ticket');
      expect((svg?.compareDocumentPosition(label) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    });

    it('puts a trailing icon after the label, at the far edge with justify="between"', () => {
      render(<Button variant="strong" label="Merge worktree → main" trailingIcon="arrow-right" justify="between" />);
      const button = screen.getByRole('button', { name: 'Merge worktree → main' });
      const svg = button.querySelector('svg');
      const label = screen.getByText('Merge worktree → main');
      expect(svg).not.toBeNull();
      expect(label.compareDocumentPosition(svg as Node) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(getComputedStyle(surfaceOf(button)).justifyContent).toBe('space-between');
    });
  });

  describe('keyboard', () => {
    it('Tab focuses the button and shows the violet ring on its surface', async () => {
      const { user } = setup(<Button variant="primary" label="Save connections" />);
      const button = screen.getByRole('button', { name: 'Save connections' });
      expect(getComputedStyle(surfaceOf(button)).outlineStyle).not.toBe('solid');

      await user.tab();

      expect(document.activeElement).toBe(button);
      const surface = getComputedStyle(surfaceOf(button));
      expect(surface.outlineStyle).toBe('solid');
      expect(surface.outlineColor).toBe(rgb(focusRing.color));
      expect(surface.outlineWidth).toBe(`${focusRing.width}px`);
      expect(surface.outlineOffset).toBe(`${focusRing.offset}px`);
      // The target's own outline (the app's global :focus-visible rule) stays off, so there is one ring.
      expect(button.style.outlineWidth).toBe('0px');
    });

    it('moves the ring with Tab and Shift+Tab', async () => {
      const { user } = setup(
        <>
          <Button label="Cancel" />
          <Button variant="primary" label="Save connections" />
        </>,
      );
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      const save = screen.getByRole('button', { name: 'Save connections' });

      await user.tab();
      await user.tab();
      expect(document.activeElement).toBe(save);
      expect(getComputedStyle(surfaceOf(cancel)).outlineStyle).not.toBe('solid');
      expect(getComputedStyle(surfaceOf(save)).outlineStyle).toBe('solid');

      await user.tab({ shift: true });
      expect(document.activeElement).toBe(cancel);
      expect(getComputedStyle(surfaceOf(cancel)).outlineStyle).toBe('solid');
      expect(getComputedStyle(surfaceOf(save)).outlineStyle).not.toBe('solid');
    });

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
    ])('%s activates', async (_key, keys) => {
      const onPress = vi.fn();
      const { user } = setup(<Button variant="primary" label="Launch agent" onPress={onPress} />);
      await user.tab();
      await user.keyboard(keys);
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('activates on click', async () => {
      const onPress = vi.fn();
      const { user } = setup(<Button label="Build" icon="build" onPress={onPress} />);
      await user.click(screen.getByRole('button', { name: 'Build' }));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('shows no ring after a mouse click, and shows it again on the next Tab', async () => {
      const { user } = setup(
        <>
          <Button label="Build" icon="build" />
          <Button label="Stop" icon="stop" />
        </>,
      );
      const build = screen.getByRole('button', { name: 'Build' });
      await user.click(build);
      expect(document.activeElement).toBe(build);
      expect(getComputedStyle(surfaceOf(build)).outlineStyle).not.toBe('solid');

      await user.tab();
      const stop = screen.getByRole('button', { name: 'Stop' });
      expect(document.activeElement).toBe(stop);
      expect(getComputedStyle(surfaceOf(stop)).outlineStyle).toBe('solid');
    });
  });

  describe('disabled', () => {
    it('blocks presses and keeps out of the Tab order', async () => {
      const onPress = vi.fn();
      const { user } = setup(
        <>
          <Button label="Cancel" />
          <Button variant="primary" label="Launch agent" disabled onPress={onPress} />
        </>,
      );
      const button = screen.getByRole('button', { name: 'Launch agent' });

      fireEvent.click(button);
      fireEvent.click(surfaceOf(button));
      // The button itself takes no pointer events, so aim past user-event's check at the surface.
      await userEvent.setup({ pointerEventsCheck: 0 }).click(surfaceOf(button));

      await user.tab();
      await user.tab();
      expect(document.activeElement).not.toBe(button);
      await user.keyboard('{Enter}');
      await user.keyboard(' ');

      expect(onPress).not.toHaveBeenCalled();
    });

    it('is announced with aria-disabled and fades back', () => {
      render(<Button variant="primary" label="Launch agent" disabled />);
      const button = screen.getByRole('button', { name: 'Launch agent' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(getComputedStyle(surfaceOf(button)).opacity).toBe(String(control.disabledOpacity));
    });

    it('does not lift on hover', async () => {
      render(<Button variant="primary" label="Launch agent" disabled />);
      const button = screen.getByRole('button', { name: 'Launch agent' });
      await userEvent.setup({ pointerEventsCheck: 0 }).hover(surfaceOf(button));
      expectAtRest(surfaceOf(button));
      expect(getComputedStyle(surfaceOf(button)).boxShadow).toBe(control.primaryShadow);
    });
  });

  describe('loading', () => {
    it('shows a spinner, keeps the label, sets aria-busy and ignores presses', async () => {
      const onPress = vi.fn();
      const { user } = setup(<Button label="Test connection" loading onPress={onPress} />);
      const button = screen.getByRole('button', { name: 'Test connection' });

      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.querySelector('[role="progressbar"]')).not.toBeNull();
      expect(screen.getByText('Test connection')).toBeTruthy();

      await user.click(button);
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
      expect(onPress).not.toHaveBeenCalled();
      // Busy, not disabled: full colour, and it doesn't lift under the pointer.
      expect(getComputedStyle(surfaceOf(button)).opacity).toBe('1');
      expectAtRest(surfaceOf(button));
    });

    it('keeps keyboard focus while its action runs', async () => {
      const onPress = vi.fn();
      const { user, rerender } = setup(<Button label="Test connection" onPress={onPress} />);
      await user.tab();
      await user.keyboard('{Enter}');
      expect(onPress).toHaveBeenCalledTimes(1);

      rerender(<Button label="Test connection" loading onPress={onPress} />);
      const button = screen.getByRole('button', { name: 'Test connection' });
      expect(document.activeElement).toBe(button);
      expect(getComputedStyle(surfaceOf(button)).outlineStyle).toBe('solid');

      rerender(<Button label="Test connection" onPress={onPress} />);
      await user.keyboard('{Enter}');
      expect(onPress).toHaveBeenCalledTimes(2);
    });

    it('swaps the leading icon for the spinner', () => {
      render(<Button variant="primary" icon="play" label="Run" loading />);
      const button = screen.getByRole('button', { name: 'Run' });
      expect(button.querySelector('svg path, svg polygon')).toBeNull();
      expect(button.querySelector('[role="progressbar"]')).not.toBeNull();
    });
  });

  describe('hover and press (design: hover lifts 3 px with a deeper soft shadow, ease-out 150–220 ms)', () => {
    it.each(buttonVariants)('%s lifts 3 px with the deeper shadow on hover and settles on unhover', async (variant) => {
      const { user } = setup(<Button variant={variant} label="Hover me" />);
      const button = screen.getByRole('button', { name: 'Hover me' });
      const deeper = variant === 'primary' ? control.primaryShadowLifted : shadow.lifted;

      await user.hover(button);
      let surface = getComputedStyle(surfaceOf(button));
      expect(surface.transform).toBe(`translateY(-${motion.hoverLiftPx}px)`);
      expect(surface.boxShadow).toBe(deeper);

      await user.unhover(button);
      expectAtRest(surfaceOf(button));
      surface = getComputedStyle(surfaceOf(button));
      expect(surface.boxShadow).toBe(artboard[variant].rest);
    });

    it('eases the lift, shadow and press over 150–220 ms ease-out', () => {
      render(<Button variant="primary" label="Run" />);
      const surface = getComputedStyle(surfaceOf(screen.getByRole('button', { name: 'Run' })));
      const properties = surface.transitionProperty.split(',').map((p) => p.trim());
      expect(properties).toEqual(expect.arrayContaining(['transform', 'box-shadow', 'filter']));
      for (const duration of surface.transitionDuration.split(',')) {
        expect(parseFloat(duration)).toBeGreaterThanOrEqual(motion.fastMs);
        expect(parseFloat(duration)).toBeLessThanOrEqual(motion.slowMs);
      }
      expect(surface.transitionTimingFunction).toBe(motion.easing);
    });

    it('darkens and drops the lift while pressed', async () => {
      const { user } = setup(<Button variant="primary" label="Send" />);
      const button = screen.getByRole('button', { name: 'Send' });
      await user.hover(button);
      act(() => {
        button.focus();
      });

      fireEvent.keyDown(button, { key: 'Enter' });
      const pressed = getComputedStyle(surfaceOf(button));
      expect(pressed.filter).toBe(control.pressedFilter);
      expect(['', 'none']).toContain(pressed.transform);

      fireEvent.keyUp(button, { key: 'Enter' });
      const released = getComputedStyle(surfaceOf(button));
      expect(['', 'none']).toContain(released.filter);
      expect(released.transform).toBe(`translateY(-${motion.hoverLiftPx}px)`);
    });
  });
});
