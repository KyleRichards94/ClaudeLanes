import { Suspense, lazy, useEffect, useState, type CSSProperties } from 'react';
import { space } from '@agent-lanes/tokens';
import { usePrefersReducedMotion } from '@/shared/lib';
import { useTicketLayout, type TicketLayout } from '@/shared/model';
import { ErrorBoundary } from '@/shared/ui';
import type { LayoutSwitchProps } from './LayoutSwitch';

// Code City is loaded the first time it is chosen (the chunk is not part of the page's first paint). The panel
// wires the widget to the ticket and imports it, so the widget comes in the same chunk.
const CodeCityPanel = lazy(() => import('./CodeCityPanel'));

/** How far a body slides while it fades, toward the side it leaves or from the side it arrives. */
export const SLIDE_PX = 24;
/** Both bodies take this long; the incoming one starts `INCOMING_DELAY_MS` late. */
export const TRANSITION_MS = 280;
export const INCOMING_DELAY_MS = 80;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** The stacked page needs a height of its own for the city. */
const STACKED_CITY_MIN_HEIGHT = 640;

interface Transition {
  from: TicketLayout;
  to: TicketLayout;
  /** `start`: the bodies are drawn at their starting styles; `run`: moved to their end styles, which the CSS transition animates. */
  phase: 'start' | 'run';
}

/**
 * Swaps the ticket page's body between Flight deck and Code City (AL-275). Only the body swaps; the header
 * above never re-renders, because only this component reads the layout.
 *
 * - The outgoing body fades to 0 and slides 24 px toward the side it leaves (Flight deck is the left side,
 *   Code City the right); the incoming one fades in from 24 px on the other side. Both 280 ms, the incoming
 *   one starting at 80 ms. Under `prefers-reduced-motion` the swap is instant.
 * - Code City is `React.lazy`: nothing is loaded until it is chosen, a grey isometric grid shows while it loads,
 *   and once visited it stays mounted, hidden with `display: none`, so the way back and forth is warm.
 * - Flight deck is always mounted: its output stream, drafts and scroll positions survive a visit to the city.
 */
export function LayoutSwitch({ flightDeck, codeCity, stacked = false }: LayoutSwitchProps) {
  const layout = useTicketLayout();
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<TicketLayout>(layout);
  const [cityVisited, setCityVisited] = useState(layout === 'codeCity');
  const [transition, setTransition] = useState<Transition | null>(null);

  // A new layout from the slider or Ctrl+Shift+L: start the swap in the same render, so no frame shows both bodies un-styled.
  if (layout !== shown) {
    setShown(layout);
    if (layout === 'codeCity') setCityVisited(true);
    setTransition(reduced ? null : { from: shown, to: layout, phase: 'start' });
  }

  const phase = transition?.phase;
  useEffect(() => {
    if (phase !== 'start') return undefined;
    // One frame with the starting styles on screen, then the end styles: that is what the CSS transition animates.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setTransition((current) => (current ? { ...current, phase: 'run' } : current)));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'run') return undefined;
    const done = setTimeout(() => setTransition(null), INCOMING_DELAY_MS + TRANSITION_MS + 40);
    return () => clearTimeout(done);
  }, [phase, transition?.to]);

  const pane = (which: TicketLayout): CSSProperties => {
    const base: CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      flex: stacked ? 'none' : '1 1 0%',
      minHeight: which === 'codeCity' && stacked ? STACKED_CITY_MIN_HEIGHT : 0,
      minWidth: 0,
      gap: space.md,
    };
    if (!transition || (which !== transition.from && which !== transition.to)) {
      return which === shown ? base : { ...base, display: 'none' };
    }
    const running = transition.phase === 'run';
    // Flight deck is on the left of Code City: going to the city, the old body leaves left and the new one arrives from the right.
    const side = transition.to === 'codeCity' ? 1 : -1;
    if (which === transition.to) {
      return {
        ...base,
        opacity: running ? 1 : 0,
        transform: running ? 'translateX(0)' : `translateX(${side * SLIDE_PX}px)`,
        transition: running ? `opacity ${TRANSITION_MS}ms ${EASING} ${INCOMING_DELAY_MS}ms, transform ${TRANSITION_MS}ms ${EASING} ${INCOMING_DELAY_MS}ms` : 'none',
      };
    }
    return {
      ...base,
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      opacity: running ? 0 : 1,
      transform: running ? `translateX(${-side * SLIDE_PX}px)` : 'translateX(0)',
      transition: running ? `opacity ${TRANSITION_MS}ms ${EASING}, transform ${TRANSITION_MS}ms ${EASING}` : 'none',
    };
  };

  return (
    <div
      data-testid="layout-switch"
      data-layout={shown}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flex: stacked ? 'none' : '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        // The sliding bodies stay inside the page while they move.
        overflow: transition ? 'hidden' : 'visible',
      }}
    >
      <div data-testid="layout-pane-flightDeck" aria-hidden={shown !== 'flightDeck' || undefined} style={pane('flightDeck')}>
        {flightDeck}
      </div>
      {cityVisited ? (
        <div data-testid="layout-pane-codeCity" aria-hidden={shown !== 'codeCity' || undefined} style={pane('codeCity')}>
          <ErrorBoundary name="ticket:code-city" label="Code City">
            <Suspense fallback={<CitySkeleton />}>
              <CodeCityPanel {...codeCity} />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : null}
    </div>
  );
}

/** A grey isometric grid plane with no buildings: what Code City looks like while its code loads. */
function CitySkeleton() {
  return (
    <div
      data-testid="code-city-skeleton"
      aria-busy="true"
      role="status"
      aria-label="Loading Code City"
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 320,
        overflow: 'hidden',
        borderRadius: 28,
        border: '1px solid #E8EDF4',
        background: 'linear-gradient(180deg, #EAF2FF 0%, #F4F7FB 55%, #EEF2F7 100%)',
        perspective: 2400,
        perspectiveOrigin: '50% 30%',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '46%',
          width: 640,
          height: 440,
          transform: 'translate(-50%, -50%) rotateX(58deg) rotateZ(-42deg)',
          borderRadius: 40,
          backgroundColor: '#F8FAFC',
          boxShadow: '0 0 0 1px #E2E8F0',
          backgroundImage: 'linear-gradient(#E2E8F0 1px, transparent 1px), linear-gradient(90deg, #E2E8F0 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
    </div>
  );
}
