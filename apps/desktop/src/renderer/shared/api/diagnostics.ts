import {
  RENDERER_ERROR_LIMITS,
  err,
  type DiagnosticsCopied,
  type RendererErrorReport,
  type Result,
} from '@agent-lanes/contracts';
import { invoke } from './ipc';

export type RendererErrorSource = RendererErrorReport['source'];

export interface RendererErrorContext {
  /** The error boundary that caught it: `app`, `page:board`, `lane:Planning`, … */
  boundary?: string;
  /** React's component stack, from `componentDidCatch`. */
  componentStack?: string | null;
}

/**
 * Writes an error the renderer caught to the main-process log (AL-214), where it is redacted and
 * shows up in "Copy diagnostics". Never throws or rejects: reporting must not cause another error.
 */
export async function reportError(source: RendererErrorSource, error: unknown, context: RendererErrorContext = {}): Promise<void> {
  try {
    const result = await invoke('app:logError', toRendererErrorReport(source, error, context));
    if (!result.ok) console.warn(`Could not log a renderer error: ${result.message}`);
  } catch (cause) {
    console.warn('Could not log a renderer error', cause);
  }
}

/** "Copy diagnostics": main builds the report (versions, settings without secrets, recent errors) and copies it. */
export async function copyDiagnostics(): Promise<Result<DiagnosticsCopied>> {
  try {
    return await invoke('app:copyDiagnostics');
  } catch (cause) {
    return err('INTERNAL', cause instanceof Error ? cause.message : String(cause));
  }
}

/** Shapes any thrown value into the `app:logError` request, cut to the contract's limits. */
export function toRendererErrorReport(source: RendererErrorSource, error: unknown, context: RendererErrorContext = {}): RendererErrorReport {
  const { name, message, stack } = describeError(error);
  const report: RendererErrorReport = { source, message: clip(message, RENDERER_ERROR_LIMITS.message) };
  if (context.boundary) report.boundary = clip(context.boundary, RENDERER_ERROR_LIMITS.boundary);
  if (name) report.name = clip(name, RENDERER_ERROR_LIMITS.name);
  if (stack) report.stack = clip(stack, RENDERER_ERROR_LIMITS.stack);
  if (context.componentStack) report.componentStack = clip(context.componentStack, RENDERER_ERROR_LIMITS.componentStack);
  return report;
}

function describeError(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message || '(no message)', stack: error.stack };
  if (typeof error === 'string') return { message: error || '(no message)' };
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    const name = 'name' in error && typeof error.name === 'string' ? error.name : undefined;
    return { name, message: error.message };
  }
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
