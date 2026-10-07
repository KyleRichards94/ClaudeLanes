import type { Emit } from './ipc/emit';

/**
 * Composition root for main-process services (design §4: each service owns one external system).
 * Each service lives in its own folder under src/main/<domain>/ and is created here, once, so
 * services can be handed to each other and to the IPC handler factories.
 *
 * Add one property per service; keep creation order so a service is created after the ones it needs.
 */
export interface Services {
  /** Main window accessors etc. are added here as services need them. */
  readonly appDataDir: string;
  /** Pushes typed events to the renderer (AL-012); services hold this, never the window. */
  readonly emit: Emit;
}

export interface ServiceOptions {
  appDataDir: string;
  emit: Emit;
}

export function createServices(options: ServiceOptions): Services {
  return {
    appDataDir: options.appDataDir,
    emit: options.emit,
  };
}

/** Stops child processes and flushes state on quit (AL-213 fills this in). */
export async function disposeServices(services: Services): Promise<void> {
  void services;
}
