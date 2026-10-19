import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom caches an element's `color` as the unresolved `light-dark()` the first time it resolves a
 * length or another colour on that element. Peel that specified form back to its light half, which
 * is the colour the real document computes under the default light scheme.
 */
const lightDarkColor = /^light-dark\((rgb\(\d+, \d+, \d+\)), rgb\(\d+, \d+, \d+\)\)$/;
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element, pseudoElement) => {
  const style = nativeGetComputedStyle(element, pseudoElement);
  return new Proxy(style, {
    get(target, prop) {
      if (prop === 'color') return target.color.replace(lightDarkColor, '$1');
      if (prop === 'getPropertyValue') {
        return (name: string) => {
          const value = target.getPropertyValue(name);
          return name === 'color' ? value.replace(lightDarkColor, '$1') : value;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

// findBy* and waitFor wait this long before failing. The default second is enough on an idle machine,
// but the full suite runs 300+ files in parallel and a `findByRole` in a modal then times out now and
// again (NewTicketModal.test, 2026-10-12); the tests still pass as soon as the render lands.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
