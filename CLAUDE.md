# Agent Lanes

Desktop app (Electron + React Native via react-native-web) for running several Claude Code agents
against Azure DevOps work items at once, one git worktree per ticket.

## Read first, every session

- `docs/TICKETS.md` is the build plan and the status tracker. Pick work from it, update its status
  table as you go, and add to its Decisions and Change log sections when you deviate.
- `docs/design/DESIGN.md` is the local copy of the design brief (section ids `§1`–`§13`, R1–R11).
  Screens are in `docs/design/screens/`. Tickets cite these ids; open the cited section before
  building a ticket.

## Working a ticket

1. Take the lowest-numbered `todo` ticket whose dependencies are all `done` (or the one asked for).
2. Set it to `in-progress` in the status table.
3. Build it to its acceptance criteria, with the tests the ticket names.
4. Run `pnpm verify` (typecheck, lint, FSD lint, unit tests, build) and, for UI or main-process
   changes, `pnpm e2e`. Only then mark it `done`.
5. Anything that differs from the ticket or the design goes in TICKETS.md → Decisions.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Electron with Vite HMR for the renderer |
| `pnpm start` | Run the built app (`electron-vite preview`) |
| `pnpm test` | Vitest: `packages`, `main` (node) and `ui` (jsdom + react-native-web) projects |
| `pnpm typecheck` / `pnpm lint` | tsc in every package / ESLint + Steiger FSD check |
| `pnpm lint:probes` | Checks that layer, process and Steiger rules still fail lint on a violation. CI (`.github/workflows/ci.yml`, Windows) runs typecheck, lint, probes, tests, build and e2e on PRs and on pushes to `main` and `feature/**` |
| `pnpm e2e` | Build, then Playwright drives the real Electron app (`apps/desktop/e2e`) |
| `pnpm verify` | Everything except e2e |
| `pnpm package` | Windows NSIS installer via electron-builder |

## Architecture rules (enforced by ESLint where possible)

- **Main process owns every secret, child process and external call.** The renderer never imports
  `electron`, `node:*`, `@agent-lanes/ado-client` or the Agent SDK; it calls `invoke()` from
  `@/shared/api`. Tokens never cross IPC; only status does.
- **Every IPC channel is declared in `packages/contracts/src/domains/`:** its name in
  `<domain>.names.ts` (zod-free, the preload imports it), its zod request/response or event payload in
  `<domain>.schemas.ts`. Handlers return `Result<T>` (`ok` / `err(code, …)`) and never throw across
  IPC. The domain's `createXHandlers()` lives in `src/main/<domain>/handlers.ts`, its service is
  created in `src/main/services.ts`, and `src/main/ipc/handlers.ts` spreads one factory per domain;
  `InvokeHandlers` fails the build until every channel has a handler.
- **Renderer follows Feature-Sliced Design:** `app → processes → pages → features → entities →
  shared`, imports only downward, slices are imported through their `index.ts`, and same-layer
  slices never import each other. Use `@/layer/slice` aliases across slices, relative paths inside.
- **UI is React Native.** Import from `react-native`; web-only code goes in `*.web.tsx` files next
  to the component. Primitives live in `packages/ui`, values in `packages/tokens` (keep the TS and
  CSS token files in sync; a test checks them).
- No databases and no user-edited config files (R2, R5). App-written JSON in the app data folder
  is fine.

## Stack notes that bite

- Vite is pinned to 7.x because electron-vite 5 does not support Vite 8; TypeScript is pinned to
  6.0.x because typescript-eslint does not support TS 7.
- TypeScript 6 no longer loads `@types/*` automatically: list `"types"` in each tsconfig.
- electron-vite 5 configures externals via `build.externalizeDeps`; workspace packages are
  excluded so they get bundled (they ship TS source). Don't enable `isolatedEntries` (crashes
  without a TTY).
- The web entry (`src/renderer/main.tsx`) imports `AppRegistry` from `react-native-web`, typed
  by `src/renderer/react-native-web.d.ts`.
- Electron 44 downloads its binary on first launch (`node node_modules/electron/install.js`).
- `AGENT_LANES_USER_DATA_DIR` points the app at another profile folder (applied before the
  single-instance lock). E2E always sets it, so tests never touch real connections and still run
  while a normal Agent Lanes window is open.
- The Agent SDK runs a native `claude` binary from `@anthropic-ai/claude-agent-sdk-<platform>`;
  it must stay outside `app.asar` (see `electron-builder.yml`). Sessions in a worktree should
  pass `projectConfigRoot` = the main checkout so project skills and settings load.
