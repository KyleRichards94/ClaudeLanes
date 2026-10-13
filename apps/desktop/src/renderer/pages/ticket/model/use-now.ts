import { useEffect, useState } from 'react';

/** The time now, refreshed every `intervalMs` (the session pill's running time, "Changed just now"). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
