import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { Button, Text } from '@agent-lanes/ui';
import { accessibleName, authorOf, pinsFor, plotPair, REVIEW_WORDS, type Pin } from '../model/cityData';
import { fileName, type CityBuilding } from '../model/layoutCity';
import { AgentPins } from './AgentPins.web';
import { Building } from './Building.web';
import type { CitySceneProps } from './CityScene.types';
import { LabelLayer } from './LabelLayer.web';
import { buildLabels } from './labels';
import { fitScale, useAnchors, useElementSize } from './useSceneMetrics';
import './code-city.css';

type VarStyle = CSSProperties & Record<`--${string}`, string>;

/** The plane shown while loading, empty and on error: not a layout of files. */
const BACKDROP = { width: 600, depth: 340 };
const GHOSTS = [
  { x: 90, y: 110, side: 90, height: 70 },
  { x: 270, y: 60, side: 80, height: 130 },
  { x: 420, y: 170, side: 70, height: 40 },
];
const GHOST_COLOR = '#CBD5E1';
const OVERFLOW_KEY = '__overflow';
/** The tooltip shows after the pointer rests 300 ms on a building. */
const TOOLTIP_DELAY_MS = 300;
/** Pin announcements for screen readers come at most this often. */
const ANNOUNCE_EVERY_MS = 5_000;

/** Tells screen readers where agents move, at most once every 5 s ("reviewer is inspecting FailedSyncFiles.razor"). */
function useAnnouncer(pins: readonly Pin[]): string {
  const [message, setMessage] = useState('');
  const known = useRef<Map<string, string> | null>(null);
  const lastSpoken = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const next = new Map(pins.map((pin) => [pin.agent.id, `${pin.path}|${pin.verb}`]));
    const before = known.current;
    known.current = next;
    if (before === null) return; // the first render is the baseline, not news
    const changed = pins.filter((pin) => before.get(pin.agent.id) !== next.get(pin.agent.id));
    const latest = changed[changed.length - 1];
    if (!latest) return;
    const text = `${latest.agent.name} is ${latest.verb} ${fileName(latest.path)}`;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        lastSpoken.current = Date.now();
        setMessage(text);
      },
      Math.max(0, lastSpoken.current + ANNOUNCE_EVERY_MS - Date.now()),
    );
  }, [pins]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return message;
}

/** The 3D city: a CSS-3D plane of buildings, a flat overlay of labels and pins, and the listbox keyboard model. */
export function CityScene({ layout, files, agents, reviewStatus, selectedFilePath, onSelectFile, base, loading, error, onRetry, testID }: CitySceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(sceneRef);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [tipPath, setTipPath] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const tipTimer = useRef<number | undefined>(undefined);

  const skeleton = loading && files.length === 0 && !error;
  const empty = !loading && !error && files.length === 0;
  const backdrop = skeleton || empty || error !== null;
  const fit = fitScale(size, backdrop ? BACKDROP : layout);
  const anchors = useAnchors(sceneRef, layout, fit, size);

  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const order = useMemo(() => layout.buildings.map((b) => b.path), [layout]);
  const paths = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const pins = useMemo(() => pinsFor(agents, paths), [agents, paths]);
  const labels = useMemo(() => buildLabels(layout, anchors), [layout, anchors]);
  const overflowFiles = useMemo(() => {
    const placed = new Set(order);
    return files.filter((f) => !placed.has(f.path)).sort((a, b) => b.added + b.removed - (a.added + a.removed) || (a.path < b.path ? -1 : 1));
  }, [files, order]);
  const announcement = useAnnouncer(pins);

  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

  // Roving tabindex: one Tab stop for the whole city.
  const tabStop = focusPath && order.includes(focusPath) ? focusPath : selectedFilePath && order.includes(selectedFilePath) ? selectedFilePath : (order[0] ?? null);

  const hover = (path: string | null) => {
    window.clearTimeout(tipTimer.current);
    if (path === null) {
      setTipPath(null);
      return;
    }
    tipTimer.current = window.setTimeout(() => setTipPath(path), TOOLTIP_DELAY_MS);
  };

  const focusOption = (path: string) => {
    for (const option of sceneRef.current?.querySelectorAll<HTMLElement>('[role="option"][data-path]') ?? []) {
      if (option.dataset.path === path) {
        option.focus();
        return;
      }
    }
  };

  const onOptionKey = (event: KeyboardEvent<HTMLElement>, path: string) => {
    const index = order.indexOf(path);
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = Math.min(order.length - 1, index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = Math.max(0, index - 1);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = order.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelectFile(path);
        return;
      default:
        return;
    }
    event.preventDefault();
    const next = order[target];
    if (next === undefined) return;
    setFocusPath(next);
    focusOption(next);
  };

  const onSceneKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    setMoreOpen(false);
    onSelectFile(null);
  };

  const onSceneClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.cc-b,.cc-chip,.cc-popover,.cc-center,[role="option"]')) return;
    setMoreOpen(false);
    onSelectFile(null);
  };

  const describe = (b: CityBuilding) => {
    const file = byPath.get(b.path);
    const author = authorOf(file ?? { authorAgentId: null }, agents);
    const review = reviewStatus[b.path] ?? 'notReviewed';
    const district = layout.districts[b.districtIndex]?.label ?? '(root)';
    return {
      file,
      author,
      review,
      label: accessibleName({ name: b.name, district, added: b.added, removed: b.removed, author: author.name, review, binary: b.slab }),
    };
  };

  const tip = tipPath ? layout.buildings.find((b) => b.path === tipPath) : undefined;
  const tipAt = tipPath ? (anchors.buildings[tipPath] ?? anchors.rubble[tipPath]) : undefined;
  const tipInfo = tip ? describe(tip) : null;
  const overflowAt = anchors.districts[OVERFLOW_KEY];

  return (
    <div className="cc-scene-host">
    <div className="cc-scene" ref={sceneRef} data-testid={testID} onClick={onSceneClick} onKeyDown={onSceneKey}>
      <div className="cc-fit" style={{ transform: `scale(${fit})` }}>
        {backdrop ? (
          <div className={`cc-plane${skeleton ? ' cc-skeleton' : ''}`} style={{ width: BACKDROP.width, height: BACKDROP.depth }} aria-hidden="true" data-testid={skeleton ? 'city-skeleton' : undefined}>
            <div className="cc-ground" />
            {empty ? <div className="cc-plot cc-empty-plot" style={{ left: 150, top: 90, width: 300, height: 160 }} /> : null}
            {skeleton
              ? GHOSTS.map((g, i) => <Building key={i} ghost path={`ghost-${i}`} x={g.x} y={g.y} side={g.side} height={g.height} color={GHOST_COLOR} label="" selected={false} tabStop={false} />)
              : null}
          </div>
        ) : (
          <div className="cc-plane" role="listbox" aria-label="Changed files" style={{ width: layout.width, height: layout.depth }}>
            <div className="cc-ground" aria-hidden="true" />
            {layout.districts.map((d, index) => {
              const pair = plotPair(index);
              const style: VarStyle = { left: d.x, top: d.y, width: d.w, height: d.d, '--plot-bg': pair.bg, '--plot-border': pair.border };
              return (
                <div key={d.key} className="cc-plot" aria-hidden="true" data-district={d.key} style={style}>
                  <i className="cc-corner" />
                </div>
              );
            })}
            {layout.overflowPlot ? (
              <div
                className="cc-plot cc-overflow"
                aria-hidden="true"
                data-district={OVERFLOW_KEY}
                style={{ left: layout.overflowPlot.x, top: layout.overflowPlot.y, width: layout.overflowPlot.w, height: layout.overflowPlot.d }}
                onClick={(event) => {
                  event.stopPropagation();
                  setMoreOpen((open) => !open);
                }}
              >
                <i className="cc-corner" />
              </div>
            ) : null}
            {layout.buildings.map((b) => {
              if (!b.rubble) return null;
              const style: CSSProperties = { left: b.rubble.x, top: b.rubble.y, width: b.rubble.w, height: b.rubble.d };
              if (b.kind !== 'deleted') return <div key={`r:${b.path}`} className="cc-rubble" aria-hidden="true" data-rubble={b.path} style={style} />;
              // A deleted file has rubble only: the rubble tile is its option.
              const { label } = describe(b);
              return (
                <div
                  key={`r:${b.path}`}
                  className="cc-rubble"
                  role="option"
                  aria-selected={b.path === selectedFilePath}
                  aria-label={label}
                  tabIndex={tabStop === b.path ? 0 : -1}
                  data-path={b.path}
                  style={style}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectFile(b.path);
                  }}
                  onKeyDown={(event) => onOptionKey(event, b.path)}
                  onFocus={() => setFocusPath(b.path)}
                  onMouseEnter={() => hover(b.path)}
                  onMouseLeave={() => hover(null)}
                />
              );
            })}
            {layout.buildings.map((b) => {
              if (b.kind === 'deleted') return null;
              const { file, author, label } = describe(b);
              return (
                <Building
                  key={b.path}
                  path={b.path}
                  x={b.x}
                  y={b.y}
                  side={b.side}
                  height={b.height}
                  color={author.color}
                  label={label}
                  selected={b.path === selectedFilePath}
                  tabStop={tabStop === b.path}
                  uncommitted={file?.uncommitted}
                  slab={b.slab}
                  onSelect={onSelectFile}
                  onKeyDown={onOptionKey}
                  onFocus={setFocusPath}
                  onHover={hover}
                />
              );
            })}
          </div>
        )}
      </div>

      {!backdrop ? (
        <>
          <LabelLayer
            chips={labels.chips}
            districts={labels.districts}
            selectedPath={selectedFilePath}
            onSelect={onSelectFile}
            overflow={
              layout.overflow > 0
                ? { count: layout.overflow, at: overflowAt ? { x: overflowAt.x, y: overflowAt.y + 2 } : null, open: moreOpen, onToggle: () => setMoreOpen((open) => !open) }
                : null
            }
          />
          <AgentPins pins={pins} anchors={anchors} lifts={labels.lifts} />
        </>
      ) : null}

      {tipPath && tipAt && tip && tipInfo ? (
        <div className="cc-tip" aria-hidden="true" data-testid="city-tooltip" style={{ left: tipAt.x, top: tipAt.y + 14 }}>
          <span className="path">{tipPath}</span>
          <span>
            +{tip.added} −{tip.removed} · by {tipInfo.author.name} · {REVIEW_WORDS[tipInfo.review]}
          </span>
        </div>
      ) : null}

      {moreOpen && overflowAt ? (
        <div className="cc-popover" role="dialog" aria-label={`${layout.overflow} more files`} style={{ left: overflowAt.x, top: overflowAt.y - 4 }}>
          <div className="head">{layout.overflow} more files</div>
          {overflowFiles.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMoreOpen(false);
                onSelectFile(f.path);
              }}
            >
              {f.path} +{f.added} −{f.removed}
            </button>
          ))}
        </div>
      ) : null}

      {empty ? (
        <div className="cc-center caption">
          <span className="cc-lot">Empty lot — no changes against {base} yet</span>
        </div>
      ) : null}

      {error ? (
        <div className="cc-center">
          <div className="cc-error" role="alert">
            <Text variant="title">Couldn’t load the changed files</Text>
            <Text variant="meta" style={{ marginTop: 4, marginBottom: 12 }}>
              {error.message}
            </Text>
            <Button label="Retry" variant="secondary" icon="refresh" onPress={onRetry} />
          </div>
        </div>
      ) : null}

      <div className="cc-sr" role="status" aria-live="polite" aria-atomic="true" data-testid="city-live">
        {announcement}
      </div>
    </div>
    </div>
  );
}
