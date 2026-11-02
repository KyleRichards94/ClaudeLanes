import { useEffect, useState } from 'react';

/**
 * The time now, refreshed every `intervalMs` (the session pill's running time, "Changed just now"). `null` does not
 * tick: the value is from when it last did, so use it only where a stale time is harmless.
 */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
