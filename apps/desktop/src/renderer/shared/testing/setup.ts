import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy* and waitFor wait this long before failing. The default second is enough on an idle machine,
// but the full suite runs 300+ files in parallel and a `findByRole` in a modal then times out now and
// again (NewTicketModal.test, 2026-10-12); the tests still pass as soon as the render lands.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
