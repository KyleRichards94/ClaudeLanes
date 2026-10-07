import { useEffect, useState, type ReactNode } from 'react';
import { hydrateUiPrefs } from '@/shared/model';

/**
 * Holds the first render until the saved UI prefs are loaded, so lanes open collapsed the way the
 * user left them instead of flashing the defaults. If loading fails the app renders on the defaults.
 */
export function UiPrefsGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void hydrateUiPrefs().finally(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return ready ? children : null;
}
