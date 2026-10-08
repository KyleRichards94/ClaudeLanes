import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it } from 'vitest';
import { STICKY_TOP_OFFSET } from '../model/sticky';
import { StickyTop } from './StickyTop';

describe('StickyTop (web)', () => {
  it('pins its children to the top of the scroll area, above the content', () => {
    render(
      <StickyTop testID="sticky">
        <Text>Agent Lanes</Text>
      </StickyTop>,
    );
    const sticky = getComputedStyle(screen.getByTestId('sticky'));
    expect(sticky.position).toBe('sticky');
    expect(sticky.top).toBe(`${STICKY_TOP_OFFSET}px`);
    expect(Number(sticky.zIndex)).toBeGreaterThan(0);
    expect(screen.getByText('Agent Lanes')).toBeTruthy();
  });
});
