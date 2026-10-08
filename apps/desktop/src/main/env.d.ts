/**
 * True in builds with the e2e test hooks (AL-222): `electron-vite dev`, `pnpm build` and `pnpm e2e`.
 * False in `pnpm package` (`--mode release`), so the hooks are left out of the installer. Set in
 * electron.vite.config.ts.
 */
declare const __TEST_HOOKS__: boolean;
