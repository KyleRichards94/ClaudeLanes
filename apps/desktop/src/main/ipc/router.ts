import { ipcMain } from 'electron';
import { INVOKE_CHANNEL_NAMES, err, type InvokeChannel } from '@agent-lanes/contracts';
import { handleInvoke, type InvokeHandler, type InvokeHandlers, type InvokeLog } from './handle-invoke';
import { isTrustedSenderUrl } from './trusted-sender';

export interface RendererLocation {
  /** Vite dev server URL in development; undefined when loading the bundled file. */
  url: string | undefined;
  file: string;
}

/** `log` receives refused requests and failing handlers (AL-214). */
export function registerInvokeHandlers(handlers: InvokeHandlers, renderer: RendererLocation, log?: InvokeLog): void {
  for (const channel of INVOKE_CHANNEL_NAMES) {
    register(channel, handlers[channel], renderer, log);
  }
}

function register<C extends InvokeChannel>(
  channel: C,
  handler: InvokeHandler<C>,
  renderer: RendererLocation,
  log: InvokeLog | undefined,
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    if (!isTrustedSenderUrl(event.senderFrame?.url, renderer.url, renderer.file)) {
      log?.warn(`Refused ${channel} from an untrusted frame`);
      return err('VALIDATION', `Refused ${channel} from an untrusted frame`);
    }
    return handleInvoke(channel, raw, handler, log);
  });
}
