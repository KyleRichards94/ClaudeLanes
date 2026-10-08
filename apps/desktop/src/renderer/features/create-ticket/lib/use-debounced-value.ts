import { useEffect, useState } from 'react';

/**
 * `value` once it has stopped changing for `delayMs`. Values are compared by their JSON, so a new
 * object with the same contents doesn't restart the wait.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
    // `key` stands for `value`: an equal value must not restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delayMs]);
  return settled;
}
