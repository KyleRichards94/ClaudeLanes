import { ipcMain } from 'electron';
import { INVOKE_CHANNEL_NAMES, err, type InvokeChannel } from '@agent-lanes/contracts';
import { handleInvoke, type InvokeHandler, type InvokeHandlers } from './handle-invoke';
import { isTrustedSenderUrl } from './trusted-sender';

export interface RendererLocation {
  /** Vite dev server URL in development; undefined when loading the bundled file. */
  url: string | undefined;
  file: string;
}

export function registerInvokeHandlers(handlers: InvokeHandlers, renderer: RendererLocation): void {
  for (const channel of INVOKE_CHANNEL_NAMES) {
    register(channel, handlers[channel], renderer);
  }
}

function register<C extends InvokeChannel>(channel: C, handler: InvokeHandler<C>, renderer: RendererLocation): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    if (!isTrustedSenderUrl(event.senderFrame?.url, renderer.url, renderer.file)) {
      return err('VALIDATION', `Refused ${channel} from an untrusted frame`);
    }
    return handleInvoke(channel, raw, handler);
  });
}
