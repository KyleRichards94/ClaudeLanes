import { color } from '@agent-lanes/tokens';
import { DONUT_SIZE, DONUT_STROKE } from '../model/donut';
import type { DonutRingProps } from './DonutRing';

const RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const TRACK = color.line;

/**
 * Web (Electron): the donut as a plain SVG, 84 px with a 5 px stroke, one arc per agent clockwise from the top. A
 * running agent's arc pulses with SVG's own `<animate>` (no CSS needed); under reduced motion it holds still. There
 * is no text in the SVG: the total over the ring is HTML (`AgentDonut`).
 */
export function DonutRing({ segments, reduced }: DonutRingProps) {
  return (
    <svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} aria-hidden="true" focusable="false" data-testid="agent-donut-ring">
      <g transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}>
        <circle cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={RADIUS} fill="none" stroke={TRACK} strokeWidth={DONUT_STROKE} />
        {segments.map((segment) => (
          <circle
            key={segment.id}
            data-testid={`donut-segment-${segment.id}`}
            data-state={segment.state}
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={segment.color}
            strokeWidth={DONUT_STROKE}
            strokeLinecap="butt"
            strokeDasharray={segment.dashArray}
            strokeDashoffset={segment.dashOffset}
          >
            {segment.pulse && !reduced ? <animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" /> : null}
          </circle>
        ))}
      </g>
    </svg>
  );
}
