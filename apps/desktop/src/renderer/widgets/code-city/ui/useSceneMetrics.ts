import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { CityLayout } from '../model/layoutCity';

/** Web-only hooks for the 3D scene: fit-to-panel size and the projected anchors that labels and pins sit on. */

export interface Size {
  w: number;
  h: number;
}

/** The element's size, kept up to date with a ResizeObserver (absent in jsdom: the size stays 0). */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (!box) return;
      setSize((prev) => (prev.w === box.width && prev.h === box.height ? prev : { w: box.width, h: box.height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** `fit = min(sceneW / (width * 1.35), sceneH / (depth * 1.15), 1)`; 1 while the scene is unmeasured or empty. */
export function fitScale(scene: Size, layout: Pick<CityLayout, 'width' | 'depth'>): number {
  if (scene.w <= 0 || scene.h <= 0 || layout.width <= 0 || layout.depth <= 0) return 1;
  return Math.min(scene.w / (layout.width * 1.35), scene.h / (layout.depth * 1.15), 1);
}

export interface Point {
  x: number;
  y: number;
}

export interface Anchors {
  /** Top face of each building, by path: the horizontal centre and the top edge of its projected bounding box. */
  buildings: Record<string, Point>;
  /** Front-left corner of each district plot, by key. */
  districts: Record<string, Point>;
  /** Rubble tiles, by path. */
  rubble: Record<string, Point>;
}

export const NO_ANCHORS: Anchors = { buildings: {}, districts: {}, rubble: {} };

/** One read pass over the plane: every `getBoundingClientRect`, relative to the scene. */
export function measureAnchors(scene: HTMLElement): Anchors {
  const origin = scene.getBoundingClientRect();
  const anchors: Anchors = { buildings: {}, districts: {}, rubble: {} };
  const topOf = (rect: DOMRect): Point => ({ x: rect.left + rect.width / 2 - origin.left, y: rect.top - origin.top });
  for (const building of scene.querySelectorAll<HTMLElement>('.cc-b[data-path]')) {
    const top = building.querySelector('.top');
    if (top) anchors.buildings[building.dataset.path!] = topOf(top.getBoundingClientRect());
  }
  // A deleted file's rubble is its option (`data-path`); other rubble tiles are decoration (`data-rubble`).
  for (const tile of scene.querySelectorAll<HTMLElement>('.cc-rubble[data-path],.cc-rubble[data-rubble]')) {
    anchors.rubble[tile.dataset.path ?? tile.dataset.rubble!] = topOf(tile.getBoundingClientRect());
  }
  for (const plot of scene.querySelectorAll<HTMLElement>('.cc-plot[data-district]')) {
    const corner = plot.querySelector('.cc-corner');
    if (!corner) continue;
    const rect = corner.getBoundingClientRect();
    anchors.districts[plot.dataset.district!] = { x: rect.left - origin.left, y: rect.top + rect.height - origin.top };
  }
  return anchors;
}

/** Milliseconds a re-layout takes to slide the buildings (`.cc-b` transitions left and top for 300 ms). */
const SLIDE_MS = 320;

/**
 * Projected anchors, in the scene's own px. After a layout or a resize, one `getBoundingClientRect` read pass in
 * `requestAnimationFrame`, then one state write. A new layout waits out the 300 ms slide first, so the read never
 * happens during a transition; the labels glide to their new spots with their own transition.
 */
export function useAnchors(sceneRef: RefObject<HTMLElement | null>, layout: CityLayout, fit: number, size: Size): Anchors {
  const [anchors, setAnchors] = useState<Anchors>(NO_ANCHORS);
  const previous = useRef<CityLayout | null>(null);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // A layout that replaces another with buildings slides them; the first one (or one after an empty city) does not.
    const before = previous.current;
    const slides = before !== null && before !== layout && before.buildings.length > 0 && layout.buildings.length > 0;
    previous.current = layout;
    let frame = 0;
    const read = () => {
      frame = requestAnimationFrame(() => setAnchors(measureAnchors(scene)));
    };
    const timer = slides ? window.setTimeout(read, SLIDE_MS) : undefined;
    if (!slides) read();
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [sceneRef, layout, fit, size.w, size.h]);

  return anchors;
}
