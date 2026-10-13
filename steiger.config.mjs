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
    files: ['./apps/desktop/src/renderer/features/board-digest/**'],
    rules: {
      // The board digest (AL-272) belongs to the board page alone: it reads the whole ticket store.
      'fsd/insignificant-slice': 'off',
    },
  },
  {
    files: ['./apps/desktop/src/renderer/features/rewind-fork/**'],
    rules: {
      // Rewind to here and Fork from here (AL-265) act on the drill-in's output alone.
      'fsd/insignificant-slice': 'off',
    },
  },
  {
    files: ['./apps/desktop/src/renderer/widgets/code-city/**', './apps/desktop/src/renderer/widgets/flight-deck/**'],
    rules: {
      // The ticket page's two layouts (AL-279 Flight deck, AL-280..AL-283 Code City) are one widget each, used by
      // the ticket page alone; Code City is also loaded with React.lazy, so Steiger counts no static reference to it.
      'fsd/insignificant-slice': 'off',
    },
  },
  {
    files: [
      './apps/desktop/src/renderer/entities/agent/**',
      './apps/desktop/src/renderer/entities/diff-file/**',
      './apps/desktop/src/renderer/entities/review-finding/**',
      './apps/desktop/src/renderer/entities/turn/**',
      './apps/desktop/src/renderer/features/ticket-insight/**',
      './apps/desktop/src/renderer/widgets/layout-slider/**',
    ],
    rules: {
      // The ticket layouts' building blocks (AL-275–AL-278) are read by the ticket page, features/ticket-insight and the
      // two layout widgets. Steiger counts no reference from a slice it exempts (Flight deck, Code City, ticket-insight
      // itself), so each still shows the page as its only user; the layout slider is only the page's header. Drop an
      // entry when its slice gains a user from a slice that is not exempt.
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
