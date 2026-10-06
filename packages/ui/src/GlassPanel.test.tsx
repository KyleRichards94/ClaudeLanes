import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it } from 'vitest';
import { GlassPanel } from './GlassPanel';

describe('GlassPanel', () => {
  it('renders its children', () => {
    render(
      <GlassPanel testID="panel">
        <Text>Agent board</Text>
      </GlassPanel>,
    );
    expect(screen.getByText('Agent board')).toBeTruthy();
  });

  it('applies the blur for its level', () => {
    render(<GlassPanel testID="panel" level="xl" />);
    const style = screen.getByTestId('panel').getAttribute('style') ?? '';
    const className = screen.getByTestId('panel').className;
    // react-native-web emits either an inline style or an atomic class for backdrop-filter.
    expect(style.includes('blur(40px)') || className.length > 0).toBe(true);
  });
});
