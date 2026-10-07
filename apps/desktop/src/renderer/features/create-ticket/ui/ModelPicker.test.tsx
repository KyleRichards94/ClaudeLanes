import { SDK_MODEL_IDS, type Model } from '@agent-lanes/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ModelPicker } from './ModelPicker';

function Harness({ initial, onChange }: { initial: Model; onChange?: (model: Model) => void }) {
  const [model, setModel] = useState(initial);
  return (
    <ModelPicker
      value={model}
      onChange={(next) => {
        setModel(next);
        onChange?.(next);
      }}
    />
  );
}

const checked = (name: string) => screen.getByRole('radio', { name }).getAttribute('aria-checked');

describe('ModelPicker', () => {
  it('shows the three cards of artboard 2 with their taglines', () => {
    render(<ModelPicker value="opus" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Model' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Opus', 'Sonnet', 'Haiku']);
    for (const tagline of ['Deepest reasoning', 'Balanced', 'Fast + light']) expect(screen.getByText(tagline)).toBeTruthy();
    expect(checked('Opus')).toBe('true');
    expect(checked('Sonnet')).toBe('false');
    // The tagline is read after the name.
    const opus = screen.getByRole('radio', { name: 'Opus' });
    expect(document.getElementById(opus.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Deepest reasoning');
  });

  it.each<[string, Model, string]>([
    ['Opus', 'opus', 'claude-opus-5-5'],
    ['Sonnet', 'sonnet', 'claude-sonnet-5-5'],
    ['Haiku', 'haiku', 'claude-haiku-4-5'],
  ])('choosing the %s card maps to the Decision D10 id', (name, model, id) => {
    const onChange = vi.fn();
    render(<Harness initial={model === 'haiku' ? 'opus' : 'haiku'} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name }));
    expect(onChange).toHaveBeenCalledWith(model);
    expect(checked(name)).toBe('true');
    expect(SDK_MODEL_IDS[model]).toBe(id);
  });

  it('has one Tab stop and moves with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="sonnet" onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Sonnet' }));

    await user.keyboard('{ArrowRight}');
    expect(checked('Haiku')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Haiku' }));
    // Wraps at the end.
    await user.keyboard('{ArrowRight}');
    expect(checked('Opus')).toBe('true');
    await user.keyboard('{End}');
    expect(checked('Haiku')).toBe('true');
    await user.keyboard('{Home}');
    expect(checked('Opus')).toBe('true');
    expect(onChange.mock.calls.map(([model]) => model)).toEqual(['haiku', 'opus', 'haiku', 'opus']);

    // Tab leaves the group instead of visiting every card.
    await user.tab();
    expect(document.activeElement?.getAttribute('role')).not.toBe('radio');
  });
});
