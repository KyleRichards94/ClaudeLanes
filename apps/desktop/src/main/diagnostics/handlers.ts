import { clipboard } from 'electron';
import { ok, type RendererErrorReport } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

type DiagnosticsChannel = 'app:getDiagnostics' | 'app:copyDiagnostics' | 'app:logError';

/**
 * The app domain's diagnostics channels (AL-214). `app:getInfo` stays in `app/handlers.ts`.
 * The clipboard is written here, in main, so copying works whether or not the window has focus.
 */
export function createDiagnosticsHandlers(
  services: Pick<Services, 'diagnostics' | 'log'>,
  writeClipboard: (text: string) => void = (text) => clipboard.writeText(text),
): HandlersFor<DiagnosticsChannel> {
  const rendererLog = services.log.child('renderer');
  const diagnosticsLog = services.log.child('diagnostics');

  return {
    'app:getDiagnostics': async () => ok(await services.diagnostics.collect()),

    'app:copyDiagnostics': async () => {
      const report = await services.diagnostics.collect();
      writeClipboard(report.text);
      diagnosticsLog.info(`Copied diagnostics to the clipboard (${report.text.length} characters)`);
      return ok({ characters: report.text.length });
    },

    'app:logError': (report) => {
      rendererLog.error(describeRendererError(report), rendererErrorDetail(report));
      return ok(null);
    },
  };
}

function describeRendererError(report: RendererErrorReport): string {
  const error = `${report.name ?? 'Error'}: ${report.message}`;
  switch (report.source) {
    case 'boundary':
      return `Error boundary ${report.boundary ? `"${report.boundary}" ` : ''}caught ${error}`;
    case 'window':
      return `Uncaught ${error}`;
    case 'promise':
      return `Unhandled rejection ${error}`;
  }
}

function rendererErrorDetail(report: RendererErrorReport): string | undefined {
  const parts = [report.stack, report.componentStack ? `Component stack:${report.componentStack}` : undefined].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return parts.length > 0 ? parts.join('\n') : undefined;
}
