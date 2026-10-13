import type { MouseEvent } from 'react';
import { CHIP_GAP } from '../model/cityData';
import type { ChipLabel, DistrictLabel } from './labels';
import type { Point } from './useSceneMetrics';
import './code-city.css';

export interface LabelLayerProps {
  chips: readonly ChipLabel[];
  districts: readonly DistrictLabel[];
  selectedPath: string | null;
  /** The building under the mouse or holding focus: its chips come to the front of the pile. */
  frontPath?: string | null;
  onSelect(path: string): void;
  /** The grey "{n} more files" plot's label, when files are over the cap. */
  overflow: { count: number; at: Point | null; open: boolean; onToggle(): void } | null;
}

function ChipBody({ chip }: { chip: ChipLabel }) {
  if (chip.kind === 'rubble') {
    return <>{chip.deleted ? `${chip.name} deleted −${chip.removed}` : `demolished −${chip.removed}`}</>;
  }
  if (chip.binary) {
    return (
      <>
        <span>{chip.name}</span>
        <span>binary</span>
      </>
    );
  }
  return (
    <>
      <span>{chip.name}</span>
      <span className="add">+{chip.added}</span>
      <span className="del">−{chip.removed}</span>
      {chip.tall ? <span className="tall">tall</span> : null}
    </>
  );
}

/**
 * The flat overlay: one mono chip per building at its top face's anchor, district names at the plot corners, rubble
 * labels. Chips are for the mouse (the listbox's options carry the accessible names), so they are hidden from
 * assistive tech and take no Tab stop.
 */
export function LabelLayer({ chips, districts, selectedPath, frontPath = null, onSelect, overflow }: LabelLayerProps) {
  return (
    <div className="cc-overlay">
      {districts.map((d) => (
        <div key={d.key} className="cc-district" aria-hidden="true" style={{ left: d.x, top: d.y, color: d.color }}>
          {d.text}
        </div>
      ))}
      {chips.map((chip) => (
        <div
          key={chip.key}
          className={`cc-chip${chip.kind === 'rubble' ? ' rubble' : ''}${chip.path === selectedPath ? ' sel' : ''}${chip.path === frontPath ? ' front' : ''}`}
          aria-hidden="true"
          data-chip={chip.key}
          style={{ left: chip.x, top: chip.y - CHIP_GAP - chip.lift }}
          onClick={(event: MouseEvent) => {
            event.stopPropagation();
            onSelect(chip.path);
          }}
        >
          <ChipBody chip={chip} />
        </div>
      ))}
      {overflow?.at ? (
        <button
          type="button"
          className="cc-chip more"
          aria-haspopup="dialog"
          aria-expanded={overflow.open}
          style={{ left: overflow.at.x, top: overflow.at.y }}
          onClick={(event) => {
            event.stopPropagation();
            overflow.onToggle();
          }}
        >
          {overflow.count} more files
        </button>
      ) : null}
    </div>
  );
}
