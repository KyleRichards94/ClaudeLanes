import type { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

// The boundaries design §12 places around the app's parts (AL-210). Each one fixes the boundary's
// log name and the words its fallback uses, so every lane, card and panel reports the same way.
// The app root has its own (`AppErrorRoot` in app/entrypoint).

export interface PageErrorBoundaryProps {
  /** Route name, logged as `page:<page>`. */
  page: string;
  /** What the fallback says failed: "the board", "ticket #71273". */
  label: string;
  children?: ReactNode;
}

/** Around each routed page: a page that fails to load or render leaves the app shell working. */
export function PageErrorBoundary({ page, label, children }: PageErrorBoundaryProps) {
  return (
    <ErrorBoundary name={`page:${page}`} label={label} variant="page">
      {children}
    </ErrorBoundary>
  );
}

export interface LaneErrorBoundaryProps {
  /** The lane's title as shown on the board: "Planning", "Implementing". */
  lane: string;
  children?: ReactNode;
}

/** Around each lane on the board, so one lane failing leaves the other lanes working. */
export function LaneErrorBoundary({ lane, children }: LaneErrorBoundaryProps) {
  return (
    <ErrorBoundary name={`lane:${lane}`} label={`the ${lane} lane`}>
      {children}
    </ErrorBoundary>
  );
}

export interface TicketErrorBoundaryProps {
  ticketId: string;
  children?: ReactNode;
}

/**
 * Around each agent ticket card, so a card that fails to render is replaced by its fallback while
 * the rest of its lane and the board keep working ("a failure in one ticket never blanks the board").
 */
export function TicketErrorBoundary({ ticketId, children }: TicketErrorBoundaryProps) {
  return (
    <ErrorBoundary name={`card:${ticketId}`} label={`ticket #${ticketId}`}>
      {children}
    </ErrorBoundary>
  );
}

/** The ticket panels design §12 gives their own boundary. */
export type TicketPanel = 'output' | 'subAgents' | 'designView';

const panelLabels: Record<TicketPanel, string> = {
  output: 'the output panel',
  subAgents: 'the sub-agents panel',
  designView: 'the Claude Design view',
};

export interface PanelErrorBoundaryProps {
  panel: TicketPanel;
  ticketId: string;
  children?: ReactNode;
}

/** Around the drill-in's output panel, its sub-agents panel and the Design view host. */
export function PanelErrorBoundary({ panel, ticketId, children }: PanelErrorBoundaryProps) {
  return (
    <ErrorBoundary name={`panel:${panel}:${ticketId}`} label={panelLabels[panel]}>
      {children}
    </ErrorBoundary>
  );
}
