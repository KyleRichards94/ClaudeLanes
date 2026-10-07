import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { color } from '@agent-lanes/tokens';
import { describe, expect, it } from 'vitest';
import { Icon, IconProvider, iconNames } from './Icon';

function svgIn(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no <svg> rendered');
  return svg;
}

/** The drawn shapes (path, circle, line, rect, …) inside an icon. */
function shapesIn(svg: SVGSVGElement): Element[] {
  return Array.from(svg.children);
}

describe('Icon', () => {
  it('covers the set the ticket lists', () => {
    expect(iconNames).toEqual(
      expect.arrayContaining([
        'plus',
        'link',
        'chevron-down',
        'chevron-right',
        'arrow-left',
        'arrow-right',
        'play',
        'stop',
        'build',
        'branch',
        'merge',
        'external-link',
        'refresh',
        'search',
        'check',
        'close',
        'lock',
        'alert',
        'pause',
      ]),
    );
  });

  it.each(iconNames)('draws %s as an svg', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = svgIn(container);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(shapesIn(svg).length).toBeGreaterThan(0);
  });

  describe('inherits text colour and size', () => {
    it('uses currentColor and 1em with nothing set, so it follows the enclosing text', () => {
      const { container } = render(
        <Text style={{ color: color.claude, fontSize: 20 }}>
          <Icon name="play" /> Run
        </Text>,
      );
      const svg = svgIn(container);
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('width')).toBe('1em');
      expect(svg.getAttribute('height')).toBe('1em');
      for (const shape of shapesIn(svg)) {
        expect(shape.getAttribute('stroke')).toBe('currentColor');
      }
      // currentColor and 1em resolve against the text the icon sits in.
      const computed = getComputedStyle(svg);
      expect(computed.color).toBe('rgb(91, 75, 196)'); // color.claude
      expect(computed.fontSize).toBe('20px');
    });

    it('takes colour and size from the nearest IconProvider', () => {
      const { container } = render(
        <IconProvider color={color.claudeText} size={18}>
          <Icon name="plus" />
        </IconProvider>,
      );
      const svg = svgIn(container);
      expect(svg.getAttribute('stroke')).toBe(color.claudeText);
      expect(svg.getAttribute('width')).toBe('18');
      expect(svg.getAttribute('height')).toBe('18');
    });

    it('merges nested providers, inner values winning', () => {
      const { container } = render(
        <IconProvider color={color.ink} size={14}>
          <IconProvider color={color.danger}>
            <Icon name="alert" />
          </IconProvider>
        </IconProvider>,
      );
      const svg = svgIn(container);
      expect(svg.getAttribute('stroke')).toBe(color.danger);
      expect(svg.getAttribute('width')).toBe('14');
    });

    it('lets explicit props override what it inherits', () => {
      const { container } = render(
        <IconProvider color={color.ink} size={14}>
          <Icon name="check" color={color.ok} size={12} />
        </IconProvider>,
      );
      const svg = svgIn(container);
      expect(svg.getAttribute('stroke')).toBe(color.ok);
      expect(svg.getAttribute('width')).toBe('12');
    });

    it('fills media controls with the same colour and leaves line icons unfilled', () => {
      const { container } = render(
        <IconProvider color={color.surface}>
          <Icon name="play" testID="play" />
          <Icon name="search" testID="search" />
        </IconProvider>,
      );
      const [play, search] = Array.from(container.querySelectorAll('svg'));
      expect(play?.getAttribute('fill')).toBe(color.surface);
      expect(search?.getAttribute('fill')).toBe('none');
    });
  });

  describe('accessibility', () => {
    it('hides decorative icons from screen readers', () => {
      const { container } = render(<Icon name="build" />);
      expect(svgIn(container).getAttribute('aria-hidden')).toBe('true');
      expect(screen.queryByRole('img')).toBeNull();
    });

    it('exposes a labelled icon as an image with that name', () => {
      const { container } = render(<Icon name="alert" label="Build failed" />);
      expect(screen.getByRole('img', { name: 'Build failed' })).toBe(svgIn(container));
      expect(svgIn(container).hasAttribute('aria-hidden')).toBe(false);
    });

    it('passes testID through for tests and e2e', () => {
      render(<Icon name="lock" testID="lock-icon" />);
      expect(screen.getByTestId('lock-icon').tagName.toLowerCase()).toBe('svg');
    });
  });
});
