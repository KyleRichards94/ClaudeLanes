import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/shared/api';
import { ErrorFallback, type ErrorFallbackProps } from './ErrorFallback';

export interface ErrorBoundaryProps {
  /** Logged with the error, so the log says which boundary caught it: `app`, `page:board`, `lane:Planning`. */
  name: string;
  /** What the fallback says failed, as the user knows it: "Agent Lanes", "the Planning lane". */
  label: string;
  /** Layout of the fallback; see `ErrorFallbackProps.variant`. */
  variant?: ErrorFallbackProps['variant'];
  /** Runs when the user presses Retry, before the children render again (e.g. reset a query). */
  onReset?: () => void;
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a render error below it, writes it to the main-process log (`app:logError`, AL-214) and
 * shows `ErrorFallback` with Retry and "Copy diagnostics", so one failure never blanks the rest of
 * the app (design §12). AL-210 wraps pages, lanes and panels in it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'A non-error value was thrown') };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    void reportError('boundary', error, { boundary: this.props.name, componentStack: info.componentStack });
  }

  private readonly retry = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return <ErrorFallback label={this.props.label} error={error} onRetry={this.retry} variant={this.props.variant} />;
    }
    return this.props.children;
  }
}
