import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

/** Feature-Sliced Design checks for the renderer (design §5). Run with `pnpm lint:fsd`. */
export default defineConfig([
  ...fsd.configs.recommended,
  {
    files: ['./apps/desktop/src/renderer/shared/testing/**'],
    rules: {
      // Test helpers are a shared segment that only tests import.
      'fsd/insignificant-slice': 'off',
    },
  },
  {
    rules: {
      // Design §5 keeps the processes layer for flows across pages (first run, AL-047; new ticket).
      'fsd/no-processes': 'off',
    },
  },
]);
