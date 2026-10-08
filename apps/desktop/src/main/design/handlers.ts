import { ok, type DESIGN_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** Design view channels (AL-191). Later design tickets (AL-192–AL-199) add theirs to this factory. */
export function createDesignHandlers({
  designView,
  designCanvases,
  designArtboards,
  designShip,
  designSpecs,
}: Pick<Services, 'designView' | 'designCanvases' | 'designArtboards' | 'designShip' | 'designSpecs'>): HandlersFor<(typeof DESIGN_INVOKE_CHANNELS)[number]> {
  return {
    'design:open': ({ ticketId, url, bounds }) => designView.open(ticketId, url, bounds),
    'design:setBounds': ({ ticketId, bounds }) => ok({ found: designView.setBounds(ticketId, bounds) }),
    'design:hide': ({ ticketId }) => ok({ found: designView.hide(ticketId) }),
    'design:close': ({ ticketId }) => ok({ found: designView.close(ticketId) }),
    'design:getView': ({ ticketId }) => ok({ view: designView.get(ticketId) ?? null }),
    'design:reload': ({ ticketId }) => ok({ found: designView.reload(ticketId) }),
    'design:linkCanvas': ({ ticketId, url }) => designCanvases.link(ticketId, url),
    'design:unlinkCanvas': ({ ticketId }) => designCanvases.unlink(ticketId),
    'design:openCanvas': ({ ticketId, bounds }) => designCanvases.open(ticketId, bounds),
    'design:listArtboards': ({ ticketId }) => designArtboards.list(ticketId),
    'design:shipSpec': (request) => designShip.ship(request),
    'design:getSpec': ({ ticketId, version }) => designSpecs.get(ticketId, version),
    'design:reshipSpec': ({ ticketId, version }) => designShip.reship(ticketId, version),
  };
}
