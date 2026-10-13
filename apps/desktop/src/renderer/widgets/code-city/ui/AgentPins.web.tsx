import { CHIP_GAP, type Pin } from '../model/cityData';
import type { Point } from './useSceneMetrics';
import './code-city.css';

export interface AgentPinsProps {
  pins: readonly Pin[];
  anchors: { buildings: Record<string, Point>; rubble: Record<string, Point> };
  /** Each label's nudge in px, so a pin stays clear above its label. */
  lifts: Record<string, number>;
}

/** A pin sits 30 px above its building's label anchor. */
const PIN_RISE = 30;
const PIN_STACK = 32;

/** "{name} · {verb}" pills over the files running agents are touching. */
export function AgentPins({ pins, anchors, lifts }: AgentPinsProps) {
  const seen = new Map<string, number>();
  return (
    <div className="cc-overlay" aria-hidden="true">
      {pins.map((pin) => {
        const at = anchors.buildings[pin.path] ?? anchors.rubble[pin.path];
        if (!at) return null;
        const stacked = seen.get(pin.path) ?? 0;
        seen.set(pin.path, stacked + 1);
        return (
          <div
            key={pin.agent.id}
            className="cc-pin"
            data-pin={pin.agent.id}
            style={{ left: at.x, top: at.y - CHIP_GAP - PIN_RISE - (lifts[pin.path] ?? 0) - stacked * PIN_STACK }}
          >
            <span className="cc-pill" style={{ background: pin.agent.color }}>
              {pin.agent.name} · {pin.verb}
            </span>
            <span className="cc-stem" style={{ background: pin.agent.color }} />
          </div>
        );
      })}
    </div>
  );
}
