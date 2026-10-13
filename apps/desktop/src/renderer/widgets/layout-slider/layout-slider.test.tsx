import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TicketLayout } from '@/shared/model';
import { SEGMENT_WIDTH, SLIDER_HEIGHT, SLIDER_WIDTH, dragOffset, snapLayout, thumbOffsetFor } from './lib/slider';
import { LayoutSlider } from './ui/LayoutSlider';

function setup(initial: TicketLayout = 'flightDeck') {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <LayoutSlider
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  const group = screen.getByRole('radiogroup', { name: 'Ticket layout' });
  const thumb = screen.getByTestId('layout-slider-thumb');
  return { onChange, group, thumb, deck: screen.getByRole('radio', { name: 'Flight deck' }), city: screen.getByRole('radio', { name: 'Code city' }) };
}

describe('LayoutSlider (AL-275)', () => {
  it('is a radiogroup named "Ticket layout" with two radios, a 260 x 40 track and the active one checked', () => {
    const { group, deck, city } = setup();
    expect(group.style.width).toBe(`${SLIDER_WIDTH}px`);
    expect(group.style.height).toBe(`${SLIDER_HEIGHT}px`);
    expect(group.style.borderRadius).toBe('12px');
    expect(deck.getAttribute('aria-checked')).toBe('true');
    expect(city.getAttribute('aria-checked')).toBe('false');
    expect(deck.textContent).toBe('Flight deck');
    expect(city.textContent).toBe('Code city');
    // Both radios carry an icon.
    expect(deck.querySelector('svg')).toBeTruthy();
    expect(city.querySelector('svg')).toBeTruthy();
  });

  it('has one tab stop: the selected radio', () => {
    const { deck, city } = setup('codeCity');
    expect(city.getAttribute('tabindex')).toBe('0');
    expect(deck.getAttribute('tabindex')).toBe('-1');
  });

  it('slides the thumb with a transform to the active segment', () => {
    const { thumb, city } = setup();
    expect(thumb.style.transform).toBe('translateX(0px)');
    expect(thumb.style.transition).toContain('220ms');
    expect(thumb.style.transition).toContain('cubic-bezier(0.22, 1, 0.36, 1)');
    fireEvent.click(city);
    expect(thumb.style.transform).toBe(`translateX(${SEGMENT_WIDTH}px)`);
  });

  it('switches on a click, and says nothing when the active segment is clicked again', () => {
    const { onChange, deck, city } = setup();
    fireEvent.click(deck);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(city);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('codeCity');
    expect(city.getAttribute('aria-checked')).toBe('true');
  });

  it('moves the selection with Left and Right, and focuses it', () => {
    const { onChange, deck, city } = setup();
    fireEvent.keyDown(deck, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('codeCity');
    expect(document.activeElement).toBe(city);
    fireEvent.keyDown(city, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('flightDeck');
    expect(document.activeElement).toBe(deck);
    // At an end there is nowhere further to go.
    fireEvent.keyDown(deck, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(deck, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('codeCity');
  });

  it('follows a dragged thumb and snaps to the nearer side on release', () => {
    const { onChange, group, thumb } = setup();
    fireEvent.pointerDown(group, { clientX: 60, button: 0, pointerId: 1 });
    fireEvent.pointerMove(group, { clientX: 60 + 100, pointerId: 1 });
    expect(thumb.style.transform).toBe('translateX(100px)');
    expect(thumb.style.transition).toBe('none');
    fireEvent.pointerUp(group, { clientX: 60 + 100, pointerId: 1 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('codeCity');
    expect(thumb.style.transform).toBe(`translateX(${SEGMENT_WIDTH}px)`);
  });

  it('snaps back when the thumb is let go nearer where it started', () => {
    const { onChange, group, thumb } = setup();
    fireEvent.pointerDown(group, { clientX: 60, button: 0, pointerId: 1 });
    fireEvent.pointerMove(group, { clientX: 60 + 50, pointerId: 1 });
    expect(thumb.style.transform).toBe('translateX(50px)');
    fireEvent.pointerUp(group, { clientX: 60 + 50, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(thumb.style.transform).toBe('translateX(0px)');
  });

  it('drags back from Code city, never past the track, and a drag does not also click', () => {
    const { onChange, group, city, deck } = setup('codeCity');
    fireEvent.pointerDown(group, { clientX: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(group, { clientX: 0, pointerId: 1 });
    expect(screen.getByTestId('layout-slider-thumb').style.transform).toBe('translateX(0px)');
    fireEvent.pointerUp(group, { clientX: 0, pointerId: 1 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('flightDeck');
    // The click that ends a drag lands on a segment; it is not a choice.
    fireEvent.click(city);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The next real click works.
    fireEvent.pointerDown(group, { clientX: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(group, { clientX: 200, pointerId: 1 });
    fireEvent.click(city);
    expect(onChange).toHaveBeenLastCalledWith('codeCity');
    expect(deck.getAttribute('aria-checked')).toBe('false');
  });

  it('treats a press that barely moves as a click, not a drag', () => {
    const { onChange, group, thumb, city } = setup();
    fireEvent.pointerDown(group, { clientX: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(group, { clientX: 202, pointerId: 1 });
    expect(thumb.style.transform).toBe('translateX(0px)');
    fireEvent.pointerUp(group, { clientX: 202, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(city);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('codeCity');
  });
});

describe('slider geometry', () => {
  it('is 126 px from one side to the other, snaps at the middle and stays on the track', () => {
    expect(SEGMENT_WIDTH).toBe(126);
    expect(thumbOffsetFor('flightDeck')).toBe(0);
    expect(thumbOffsetFor('codeCity')).toBe(126);
    expect(snapLayout(62)).toBe('flightDeck');
    expect(snapLayout(64)).toBe('codeCity');
    expect(dragOffset(0, -30)).toBe(0);
    expect(dragOffset(126, 30)).toBe(126);
    expect(dragOffset(0, 70)).toBe(70);
  });
});
