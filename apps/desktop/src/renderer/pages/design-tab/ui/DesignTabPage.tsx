import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import type { TicketRecord } from '@agent-lanes/contracts';
import { color, radius, shadow, space } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import { agentTickets, ticketFromRecord, useAgentTicket } from '@/entities/agent-ticket';
import { invoke, useDesignCanvasSlot, useTicketRecord } from '@/shared/api';
import { setDesignViewState, useDesignViewState, useEmbedMode } from '@/shared/model';
import { ErrorBoundary, TicketTabBar } from '@/shared/ui';
import { BrowserBar } from './BrowserBar';
import { DesignHeader } from './DesignHeader';
import { LinkCanvasForm } from './LinkCanvasForm';
import { AttachedSection } from './SideSection';

export interface DesignTabPageProps {
  ticketId: string;
}

/**
 * Route `ticket/:id/design`, the ticket's Claude Design tab (artboard 4): a compact ticket header,
 * the drill-in's tab bar, a browser-style bar over the canvas, and the side panel. In webview mode
 * main draws the ticket's live canvas view over the canvas placeholder (AL-191); leaving the tab
 * only hides it. The tab works the same in every stage, Queued to Done (R11): nothing here waits on
 * or pauses the agent.
 */
export function DesignTabPage({ ticketId }: DesignTabPageProps) {
  const live = useAgentTicket(ticketId);
  const recordQuery = useTicketRecord(ticketId);
  const record = recordQuery.data ?? undefined;
  const ticket = live ?? (record ? ticketFromRecord(record) : undefined);
  const mode = useEmbedMode(ticketId);
  const view = useDesignViewState(ticketId);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (record && !agentTickets.getState().byId.has(record.id)) agentTickets.upsert(record);
  }, [record]);

  // A view opened earlier (another visit, before a reload of the renderer) reports its state now.
  useEffect(() => {
    let cancelled = false;
    void invoke('design:getView', { ticketId }).then((result) => {
      if (!cancelled && result.ok) setDesignViewState(ticketId, result.data.view);
    });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const canvas = record?.design.canvas ?? null;
  // "Open in Claude ↗": the canvas page the view shows now, else the one it was last left on, else the canvas (AL-193).
  const openUrl = canvas ? (view?.url?.startsWith(canvas.url) ? view.url : (record?.design.lastViewUrl ?? canvas.url)) : null;

  return (
    <View style={styles.page} testID="design-tab-page">
      <DesignHeader ticketId={ticketId} ticket={ticket} />
      <TicketTabBar ticketId={ticketId} value="design" style={styles.tabs} />

      <View style={styles.body}>
        <View style={styles.canvasCard}>
          <BrowserBar
            label={canvas ? `claude.ai/design · ${ticketId} canvas` : null}
            mode={mode}
            status={view?.status}
            onReload={mode === 'webview' && view && !changing ? () => void invoke('design:reload', { ticketId }) : undefined}
            onOpenExternal={openUrl ? () => void Linking.openURL(openUrl) : undefined}
            onChangeCanvas={canvas && !changing ? () => setChanging(true) : undefined}
          />
          <ErrorBoundary name="design:canvas" label="the canvas">
            <CanvasArea
              ticketId={ticketId}
              record={record}
              loading={recordQuery.isPending}
              webview={mode === 'webview'}
              changing={changing}
              onChanged={() => setChanging(false)}
            />
          </ErrorBoundary>
        </View>

        <ScrollView style={styles.side} contentContainerStyle={styles.sideContent} testID="design-side-panel">
          <AttachedSection specs={record?.design.specs ?? []} />
        </ScrollView>
      </View>
    </View>
  );
}

interface CanvasAreaProps {
  ticketId: string;
  record: TicketRecord | undefined;
  loading: boolean;
  webview: boolean;
  /** The user is replacing or unlinking the linked canvas. */
  changing: boolean;
  onChanged: () => void;
}

function CanvasArea({ ticketId, record, loading, webview, changing, onChanged }: CanvasAreaProps) {
  if (loading) {
    return (
      <View style={styles.empty} aria-busy>
        <Text variant="meta" size="md">
          Loading the ticket…
        </Text>
      </View>
    );
  }
  if (!record) {
    return (
      <View style={styles.empty}>
        <Text variant="meta" size="md" testID="design-missing">
          This ticket isn&apos;t on the board, so it has no canvas.
        </Text>
      </View>
    );
  }
  const canvas = record.design.canvas;
  // The placeholder unmounts while the form shows, which hides the live view without closing it.
  if (!canvas || changing) return <LinkCanvasForm ticketId={ticketId} current={canvas?.url} onDone={onChanged} />;
  if (!webview) return null;
  return <CanvasSlot ticketId={ticketId} canvasUrl={canvas.url} />;
}

/** The placeholder main draws the live canvas view over, opened where it was left (AL-191, AL-193). */
function CanvasSlot({ ticketId, canvasUrl }: { ticketId: string; canvasUrl: string }) {
  const slot = useDesignCanvasSlot(ticketId, canvasUrl);
  return <View ref={slot} style={styles.slot} testID="design-canvas-slot" />;
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    padding: space.xl,
    gap: space.lg,
  },
  tabs: {
    alignSelf: 'flex-start',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    gap: space.lg,
    minHeight: 0,
  },
  canvasCard: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    boxShadow: shadow.card,
  },
  slot: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  side: {
    width: 340,
    flexGrow: 0,
  },
  sideContent: {
    gap: space.lg,
  },
});
