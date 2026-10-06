import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rendererRoot = fileURLToPath(new URL('./apps/desktop/src/renderer', import.meta.url));
const webExtensions = ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.mjs', '.json'];

/**
 * Test levels from design §12. Node projects cover packages and the main process;
 * the jsdom project renders React Native components through react-native-web,
 * the same way the Electron renderer does.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/{contracts,tokens,ado-client}/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['apps/desktop/src/main/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@': rendererRoot,
            'react-native': 'react-native-web',
          },
          extensions: webExtensions,
        },
        define: {
          __DEV__: 'true',
        },
        esbuild: {
          jsx: 'automatic',
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['packages/ui/src/**/*.test.tsx', 'apps/desktop/src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./apps/desktop/src/renderer/shared/testing/setup.ts'],
        },
      },
    ],
  },
});
