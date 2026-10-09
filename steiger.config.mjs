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
    files: ['./apps/desktop/src/renderer/features/agent-menu/**'],
    rules: {
      // The drill-in's Agent ▾ menu (AL-253) is one slice several tickets add items to (AL-257, AL-263,
      // AL-264); only the ticket page mounts it.
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
