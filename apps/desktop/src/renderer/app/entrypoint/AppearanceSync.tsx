import { useEffect } from 'react';
import { useAppearance } from '@/shared/model';

/**
 * Applies the saved appearance to the document. `light-dark()` colours follow `color-scheme`;
 * the ground animation follows `data-theme`, which is the computer's choice when appearance is system.
 */
export function AppearanceSync() {
  const appearance = useAppearance();

  useEffect(() => {
    const root = document.documentElement;
    if (appearance === 'system') {
      root.style.colorScheme = 'light dark';
      if (typeof window.matchMedia !== 'function') {
        root.dataset.theme = 'light';
        return undefined;
      }
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      const sync = () => {
        root.dataset.theme = query.matches ? 'dark' : 'light';
      };
      sync();
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
    }
    root.style.colorScheme = appearance;
    root.dataset.theme = appearance;
    return undefined;
  }, [appearance]);

  return null;
}
