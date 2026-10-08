import { useMemo, type ReactNode } from 'react';
import type { LaunchFromLane } from '../model/types';
import { useDropOnLane } from '../model/use-drop';
import { AnnouncementRegion } from './AnnouncementRegion';
import { DragToLaneContext } from './context';

export interface DragToLaneProviderProps {
  /** Starts the agent for a drop (AL-236's `useLaunchFromAdo`). Without it a drop says it can't start one yet. */
  onLaunch?: LaunchFromLane;
  /**
   * Scroll the board when a dragged card nears its edge (default true). The board turns it off while
   * its collapsed strip is pinned at the top, so hovering a strip cell doesn't scroll the page under it.
   */
  autoScroll?: boolean;
  children: ReactNode;
}

/** Native builds have no dnd-kit: cards go to a lane through the "Send to lane" menu only. */
export function DragToLaneProvider({ onLaunch, children }: DragToLaneProviderProps) {
  const drop = useDropOnLane(onLaunch);
  const value = useMemo(() => ({ drop }), [drop]);
  return (
    <DragToLaneContext.Provider value={value}>
      {children}
      <AnnouncementRegion />
    </DragToLaneContext.Provider>
  );
}
