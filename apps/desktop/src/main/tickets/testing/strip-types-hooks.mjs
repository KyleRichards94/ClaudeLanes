// Loads the main-process TypeScript sources in a plain Node child process (the kill test in
// record-store.kill.test.ts), using Node's built-in type stripping. The sources import relative
// modules without an extension, as the bundler allows; this hook tries `.ts` and `/index.ts`.
import { registerHooks } from 'node:module';

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[cm]?[jt]s$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!RELATIVE.test(specifier) || HAS_EXTENSION.test(specifier)) throw error;
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return nextResolve(`${specifier}${suffix}`, context);
        } catch {
          // Try the next form.
        }
      }
      throw error;
    }
  },
});
