# Agent Lanes — Build Plan and Tickets

This is the build plan for a feature-complete Agent Lanes, and the place its progress is tracked.
It is derived from the design brief (`docs/design/DESIGN.md`, cited as `§n` and `Rn`) and the seven
artboards in `docs/design/screens/`. 126 tickets in 14 epics take the app from an empty folder to a
packaged Windows installer. 13 are done (the Electron environment, typed IPC, the token package and
GlassPanel), 1 is in progress and 2 are blocked on decisions only Kyle can make.

- **Status values:** `todo` · `in-progress` · `blocked` · `done` · `partial` (merged, with acceptance
  criteria still open; they stay unchecked in the ticket body with a note). The status board in §2
  is the only place status lives; ticket bodies don't repeat it.
- **Parallel build:** tickets are being built by one sub-agent each, on their own branch, and merged
  into `main` by an integrator. The rules are in §7.
- **Sizes:** S ≤ ½ day · M 1–2 days · L 3–5 days.
- **Picking work:** take the lowest-numbered `todo` ticket whose dependencies are all `done`, unless
  a milestone says otherwise. Open the cited design sections and artboard before starting.
- **Definition of done (every ticket):** acceptance criteria met; the tests listed under the ticket
  written and passing; `pnpm verify` green; `pnpm e2e` green when the main process or a screen changed;
  no secret reaches the renderer; any deviation recorded in §4 Decisions.

---

## 1. Milestones

| Milestone | Outcome a user can see | Tickets | Exit check |
|---|---|---|---|
| **M0 Foundation** | The app opens, renders RN-web with tokens and glass, and talks to the main process over typed IPC | E0, AL-010–AL-015, AL-020, AL-022 | `pnpm verify` + `pnpm e2e` green (met 2026-10-07, except AL-007/AL-008/AL-012/AL-015) |
| **M1 Walking skeleton** | Connect ADO and Claude, pick a repo, launch one agent on a real work item, and watch its card move through the lanes with live output | AL-012, AL-015, AL-021, AL-023–AL-031, AL-040–AL-047, AL-060–AL-066, AL-080–AL-083, AL-100–AL-103, AL-105, AL-140–AL-145, AL-160–AL-165, AL-170, AL-175 | Manual run against a real ADO sprint + repo: ticket reaches Implementing with streamed output |
| **M2 Control** | Gates, model/effort switching, messaging, sub-agents, crash recovery, queueing | AL-104, AL-106–AL-111, AL-113–AL-115, AL-171, AL-172, AL-176, AL-177 | Approve a plan; switch Opus→Sonnet mid-run; kill the session process and see it resume |
| **M3 Ship** | Build/run per worktree, both merges, diff, ADO tab, PR stage, archive | E7, AL-084–AL-090, AL-112, AL-173, AL-174, AL-178–AL-181 | Two tickets build and run side by side; sub-branches merge; a PR is created with checks on the card |
| **M4 Design (R10, R11)** | Claude Design beside the ticket; talk to the design at any stage; approve & ship the design to the running agent at any time | E11 | Ship a design while the agent is Implementing; the agent acknowledges and uses it without a restart |
| **M5 Release** | Hardened, accessible, tested, packaged | E12, E13, AL-032, AL-033, AL-146, AL-007, AL-008 | Golden-path e2e green; installer installs and runs on a clean Windows machine |

---

## 2. Status board

| ID | Ticket | Epic | Size | Depends on | Status |
|---|---|---|---|---|---|
| AL-001 | Monorepo workspace | E0 | S | — | done |
| AL-002 | Electron shell with secure defaults | E0 | S | AL-001 | done |
| AL-003 | React Native Web renderer + React Compiler | E0 | S | AL-002 | done |
| AL-004 | Lint: ESLint boundaries + Steiger FSD | E0 | S | AL-003 | done |
| AL-005 | Unit test harness | E0 | S | AL-003 | done |
| AL-006 | E2E harness (Playwright for Electron) | E0 | S | AL-002 | done |
| AL-007 | Packaging (electron-builder, NSIS) | E0 | M | AL-002 | in-progress |
| AL-008 | CI pipeline | E0 | S | AL-004, AL-005, AL-006 | todo |
| AL-009 | Agent docs: CLAUDE.md, design copy, this plan | E0 | S | — | done |
| AL-010 | Result type and error codes | E1 | S | AL-001 | done |
| AL-011 | Invoke channels: contracts, router, validation, trusted sender | E1 | S | AL-010 | done |
| AL-012 | Event channels: main → renderer push | E1 | S | AL-011 | todo |
| AL-013 | Preload bridge | E1 | S | AL-011 | done |
| AL-014 | Renderer IPC client | E1 | S | AL-013 | done |
| AL-015 | Event hub in the app layer | E1 | S | AL-012 | todo |
| AL-020 | Tokens package (TS + CSS) | E2 | S | AL-001 | done |
| AL-021 | Bundled fonts | E2 | S | AL-020 | todo |
| AL-022 | GlassPanel | E2 | S | AL-020 | done |
| AL-023 | Text primitives | E2 | S | AL-021 | todo |
| AL-024 | Button | E2 | S | AL-023 | todo |
| AL-025 | Pill, Badge, StatusBadge, IdChip | E2 | S | AL-023 | todo |
| AL-026 | SegmentedControl and Switch | E2 | S | AL-023 | todo |
| AL-027 | TextField | E2 | S | AL-023 | todo |
| AL-028 | Card and ProgressBar | E2 | S | AL-022 | todo |
| AL-029 | Modal and Tabs | E2 | M | AL-022, AL-024 | todo |
| AL-030 | Toast and ToastHost | E2 | S | AL-024 | todo |
| AL-031 | Icons | E2 | S | AL-020 | todo |
| AL-032 | Component gallery (dev route) | E2 | S | AL-023–AL-031 | todo |
| AL-033 | Accessibility checks | E2 | S | AL-032 | todo |
| AL-040 | Secret store (safeStorage) | E3 | M | AL-011 | todo |
| AL-041 | Settings store and UI prefs | E3 | M | AL-011 | todo |
| AL-042 | Connections service and IPC | E3 | M | AL-040, AL-041 | todo |
| AL-043 | ADO connection test | E3 | M | AL-042, AL-060 | todo |
| AL-044 | Claude connection | E3 | M | AL-042 | todo |
| AL-045 | MCP server entries | E3 | M | AL-042 | todo |
| AL-046 | Connections modal UI | E3 | L | AL-043, AL-044, AL-045, AL-027, AL-029 | todo |
| AL-047 | First-run flow and repo picker | E3 | M | AL-046, AL-081 | todo |
| AL-048 | Credential failure handling | E3 | M | AL-046, AL-100, AL-030 | todo |
| AL-060 | ado-client core | E4 | M | AL-001 | todo |
| AL-061 | Sprints (iterations) | E4 | S | AL-060 | todo |
| AL-062 | Work items: sprint list, search, get | E4 | M | AL-060 | todo |
| AL-063 | Work item write-back (comments, state) | E4 | S | AL-060 | todo |
| AL-064 | Pull requests: create, link, checks | E4 | M | AL-060 | todo |
| AL-065 | Main ADO service, IPC and MSW fixtures | E4 | M | AL-061–AL-064, AL-042 | todo |
| AL-066 | Renderer ADO queries and refetch policy | E4 | S | AL-065 | todo |
| AL-080 | Git runner | E5 | S | AL-001 | todo |
| AL-081 | Repo registry and folder picker | E5 | M | AL-080, AL-041 | todo |
| AL-082 | Branch and worktree naming | E5 | S | — | todo |
| AL-083 | Create the ticket worktree | E5 | M | AL-081, AL-082 | todo |
| AL-084 | Sub-agent worktrees (WorktreeCreate hook) | E5 | M | AL-083, AL-100 | todo |
| AL-085 | Branch status | E5 | S | AL-083 | todo |
| AL-086 | Merge sub-branches → ticket branch | E5 | M | AL-084, AL-085 | todo |
| AL-087 | Merge worktree → main | E5 | M | AL-085 | todo |
| AL-088 | Archive | E5 | M | AL-083 | todo |
| AL-089 | Diff provider | E5 | S | AL-083 | todo |
| AL-090 | Start-up reconciliation | E5 | M | AL-083, AL-101 | todo |
| AL-100 | Session manager core | E6 | L | AL-083, AL-044 | todo |
| AL-101 | Ticket records | E6 | M | AL-041 | todo |
| AL-102 | Output normalisation and transcript buffer | E6 | L | AL-100, AL-012 | todo |
| AL-103 | Stage protocol: `agent_lanes` MCP server | E6 | M | AL-100 | todo |
| AL-104 | Stage gates | E6 | M | AL-103 | todo |
| AL-105 | Messages, skills and pause | E6 | S | AL-100 | todo |
| AL-106 | Live model and effort change | E6 | M | AL-100 | todo |
| AL-107 | Sub-agent tracking | E6 | M | AL-102 | todo |
| AL-108 | MCP injection and status | E6 | M | AL-100, AL-045 | todo |
| AL-109 | Permission policy for headless sessions | E6 | M | AL-100 | todo |
| AL-110 | Crash recovery | E6 | M | AL-100, AL-101 | todo |
| AL-111 | Concurrency cap and Queued lane | E6 | S | AL-100 | todo |
| AL-112 | Build result as next-turn context | E6 | S | AL-100, AL-132 | todo |
| AL-113 | Usage, tokens and session pill | E6 | S | AL-102 | todo |
| AL-114 | Skill discovery | E6 | S | AL-100 | todo |
| AL-115 | ADO write-back on stage change | E6 | S | AL-103, AL-063 | todo |
| AL-130 | Build/run command detection and overrides | E7 | S | AL-081 | todo |
| AL-131 | Job queue | E7 | S | AL-011 | todo |
| AL-132 | Build job and log parsing | E7 | M | AL-130, AL-131, AL-012 | todo |
| AL-133 | Run job, port and URL | E7 | M | AL-132 | todo |
| AL-134 | Stop and process-tree kill | E7 | S | AL-133 | todo |
| AL-135 | Build log tab | E7 | M | AL-132, AL-029 | todo |
| AL-140 | App router and lazy pages | E8 | S | AL-003 | todo |
| AL-141 | Agent ticket entity and store | E8 | M | AL-015, AL-101 | todo |
| AL-142 | Board header | E8 | M | AL-141, AL-066, AL-024, AL-025, AL-081 | todo |
| AL-143 | Lanes | E8 | M | AL-141 | todo |
| AL-144 | AgentTicketCard and its states | E8 | M | AL-141, AL-025, AL-028 | todo |
| AL-145 | Live dock | E8 | S | AL-141 | todo |
| AL-146 | Settings panel (repo and defaults) | E8 | M | AL-041, AL-130, AL-029 | todo |
| AL-160 | New-ticket modal shell and form state | E9 | M | AL-029 | todo |
| AL-161 | Work item picker | E9 | M | AL-160, AL-066 | todo |
| AL-162 | Job description and skill chips | E9 | S | AL-160, AL-114 | todo |
| AL-163 | Model and effort pickers | E9 | S | AL-160, AL-026 | todo |
| AL-164 | Workspace preview and stage gates | E9 | S | AL-160, AL-082 | todo |
| AL-165 | Launch | E9 | M | AL-161–AL-164, AL-083, AL-100, AL-111 | todo |
| AL-170 | Ticket page frame | E10 | M | AL-140, AL-141 | todo |
| AL-171 | Stage stepper and gate actions | E10 | M | AL-104, AL-170 | todo |
| AL-172 | Agent panel (model and effort) | E10 | S | AL-106, AL-170 | todo |
| AL-173 | Worktree panel (Build, Run, Stop) | E10 | S | AL-134, AL-170 | todo |
| AL-174 | Merge panel, confirm and conflict flows | E10 | M | AL-086, AL-087, AL-170 | todo |
| AL-175 | Output stream | E10 | L | AL-102, AL-170 | todo |
| AL-176 | Composer | E10 | S | AL-105, AL-106, AL-175 | todo |
| AL-177 | Sub-agents panel | E10 | M | AL-107, AL-170 | todo |
| AL-178 | Sub-branches panel | E10 | S | AL-085, AL-177 | todo |
| AL-179 | Diff tab | E10 | M | AL-089, AL-170 | todo |
| AL-180 | ADO tab | E10 | M | AL-066, AL-170 | todo |
| AL-181 | Create PR stage | E10 | M | AL-064, AL-104, AL-170 | todo |
| AL-190 | Spike: Claude Design integration surface | E11 | S | — | todo |
| AL-191 | Design view service (WebContentsView) | E11 | L | AL-190, AL-011 | todo |
| AL-192 | Design tab page | E11 | M | AL-191, AL-140, AL-170 | todo |
| AL-193 | Link a canvas to a ticket | E11 | S | AL-101, AL-192 | todo |
| AL-194 | Embed mode switch and MCP-link fallback | E11 | M | AL-190, AL-192 | todo |
| AL-195 | Artboard list and selection | E11 | M | AL-190, AL-192 | todo |
| AL-196 | Design thread at any stage (R11) | E11 | L | AL-190, AL-192 | todo |
| AL-197 | Approve & ship design at any time (R11) | E11 | L | AL-195, AL-198, AL-100 | todo |
| AL-198 | Agent-side design tools | E11 | M | AL-103 | todo |
| AL-199 | Design specs attached to the ticket | E11 | S | AL-197 | todo |
| AL-200 | Design presence on card and drill-in | E11 | S | AL-197, AL-144 | todo |
| AL-210 | Error boundaries | E12 | S | AL-140 | todo |
| AL-211 | Error recovery actions | E12 | M | AL-030, AL-046 | todo |
| AL-212 | Performance pass | E12 | M | AL-143, AL-175 | todo |
| AL-213 | App lifecycle | E12 | S | AL-100, AL-134 | todo |
| AL-214 | Logging and diagnostics | E12 | S | AL-040 | todo |
| AL-220 | Feature integration tests | E13 | M | ongoing | todo |
| AL-221 | Main-process test kit | E13 | M | AL-080, AL-100 | todo |
| AL-222 | E2E golden path | E13 | L | AL-221, AL-047, AL-165, AL-171, AL-174 | todo |
| AL-223 | Visual QA against the artboards | E13 | M | E8–E11 | todo |
| AL-224 | Release build and signing | E13 | M | AL-007 | blocked (Q7) |
| AL-225 | User guide | E13 | S | AL-047 | todo |
| AL-226 | Register in the ai-tools index | E13 | S | — | blocked (Q8) |

---

## 3. Epics and tickets

### E0 — Foundation and tooling

#### AL-001 · Monorepo workspace
- **Design:** §5 · **Depends on:** —
- **Scope:** pnpm workspace (`apps/*`, `packages/*`) with Turborepo tasks `build`, `typecheck`, `lint`, `dev`; shared `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, bundler resolution); root scripts `dev`, `start`, `test`, `typecheck`, `lint`, `e2e`, `package`, `ci`; `.gitignore`, `.editorconfig`, `.gitattributes`; pinned `packageManager`.
- **Acceptance criteria:**
  - [x] `pnpm install` on a clean clone installs everything, including the Electron binary step.
  - [x] Packages `@agent-lanes/{contracts,tokens,ui,ado-client}` and app `@agent-lanes/desktop` exist and resolve each other as `workspace:*`.
  - [x] `pnpm typecheck` runs in every package through Turborepo.
- **Tests:** `pnpm verify` is the test.

#### AL-002 · Electron shell with secure defaults
- **Design:** §4, §8 · **Depends on:** AL-001
- **Scope:** electron-vite 5 with main, preload and renderer builds; `BrowserWindow` with `contextIsolation`, `sandbox`, no `nodeIntegration`, no `webviewTag`; window opens hidden until `ready-to-show`; external `https:` links go to the OS browser and every other window open is denied; navigation away from the renderer is blocked; single-instance lock; Windows app user model ID; CSP meta in `index.html`.
- **Acceptance criteria:**
  - [x] `pnpm dev` opens the window with HMR; `pnpm start` runs the built app.
  - [x] The renderer has no `require` and no `process` (checked by e2e).
  - [x] A second launch focuses the existing window instead of opening another.

#### AL-003 · React Native Web renderer + React Compiler
- **Design:** R1, §5, §12 Performance · **Depends on:** AL-002
- **Scope:** Vite alias `react-native → react-native-web`; `.web.*` extensions resolved first; `__DEV__` define; React 19 with `babel-plugin-react-compiler`; entry mounts through `AppRegistry.runApplication`; `@/` alias to `src/renderer`; TanStack Query provider in `app/entrypoint`.
- **Acceptance criteria:**
  - [x] Components import from `react-native` and render in Electron.
  - [x] Glass (`backdropFilter`) renders in Chromium through react-native-web (seen in the smoke screenshot).
  - [x] The React Compiler runs in the renderer build.

#### AL-004 · Lint: ESLint boundaries + Steiger FSD
- **Design:** §5 ("Dependency direction is enforced in CI") · **Depends on:** AL-003
- **Scope:** ESLint 10 flat config with typescript-eslint and react-hooks (compiler-aware rules); `no-restricted-imports` rules for: FSD layer direction, no same-layer slice imports, no deep imports past a slice's `index.ts`, no `electron`/`node:*`/ado-client/Agent SDK/electron-store in the renderer, no UI code in main or preload. Steiger with the FSD plugin over `src/renderer`.
- **Acceptance criteria:**
  - [x] `pnpm lint` runs ESLint in every package and Steiger on the renderer.
  - [x] Probe files breaking each rule fail lint (verified 2026-10-07: shared→pages, `electron` in renderer, `node:fs` in renderer, deep slice import).

#### AL-005 · Unit test harness
- **Design:** §12 Testing · **Depends on:** AL-003
- **Scope:** Root `vitest.config.ts` with three projects: `packages` (node), `main` (node), `ui` (jsdom, react-native-web alias, `@testing-library/react`). Shared test helpers in `src/renderer/shared/testing` (`installFakeBridge`).
- **Acceptance criteria:**
  - [x] `pnpm test` runs all projects (45 tests on 2026-10-07).
  - [x] UI tests render React Native components through react-native-web (see Decision D4).

#### AL-006 · E2E harness (Playwright for Electron)
- **Design:** §12 Testing · **Depends on:** AL-002
- **Scope:** `apps/desktop/playwright.config.ts`, `e2e/smoke.spec.ts` launching the built app folder with a throwaway profile (`AGENT_LANES_USER_DATA_DIR`, honoured by main before the single-instance lock); screenshot to `test-results/`.
- **Acceptance criteria:**
  - [x] `pnpm e2e` builds, launches Electron, sees "Agent board", reads app version over IPC, and checks the renderer has no Node.
  - [x] Tests never touch the real profile and still run while another Agent Lanes window is open.

#### AL-007 · Packaging (electron-builder, NSIS)
- **Design:** §3 ("single installable desktop package") · **Depends on:** AL-002
- **Scope:** `electron-builder.yml` (done): app ID, NSIS per-user installer, `asarUnpack` for the Agent SDK and its platform binary package. Still to do: app icon (`build/icon.ico`, from the logo mark), verify `pnpm package` output installs and launches, verify the SDK's `claude` binary is found from the unpacked path (set `pathToClaudeCodeExecutable` if not), version stamping from `apps/desktop/package.json`.
- **Acceptance criteria:**
  - [ ] `pnpm package` produces `release/<version>/Agent Lanes-<version>-setup.exe`.
  - [ ] Installed app launches, shows the board, and can start an Agent SDK session (after AL-100).
  - [ ] Uninstall leaves no files outside the app data folder.
- **Tests:** manual install on a clean Windows VM; record result in Change log.

#### AL-008 · CI pipeline
- **Design:** §5 · **Depends on:** AL-004, AL-005, AL-006 · **Host:** GitHub Actions (Decision D17)
- **Scope:** `.github/workflows/ci.yml` running `pnpm install --frozen-lockfile`, `pnpm verify`, and `pnpm e2e` on a Windows agent (Electron needs a desktop session; use `xvfb-run` if a Linux agent is used). Cache the pnpm store and the Electron download.
- **Acceptance criteria:**
  - [ ] Every PR runs typecheck, lint, Steiger, unit tests, build and e2e.
  - [ ] Failing Steiger or a layer-rule violation fails the build.

#### AL-009 · Agent docs: CLAUDE.md, design copy, this plan
- **Scope:** `CLAUDE.md` (how to work a ticket, commands, architecture rules, stack gotchas), `docs/design/DESIGN.md` + `screens/`, this file.
- **Acceptance criteria:**
  - [x] A fresh session can pick the next ticket from this file without other context.

---

### E1 — IPC and contracts

All main ↔ renderer traffic goes through channels declared in `packages/contracts` (Decision D7).

#### AL-010 · Result type and error codes
- **Design:** §12 Error handling · **Depends on:** AL-001
- **Scope:** `Result<T> = Ok<T> | Err`, helpers `ok`, `err`, `isErrorCode`; codes `ADO_UNAUTHORIZED`, `ADO_SCOPE_MISSING`, `SESSION_LOST`, `BUILD_FAILED`, `MERGE_CONFLICT`, `GIT_DIRTY` plus `VALIDATION` and `INTERNAL` (Decision D6).
- **Acceptance criteria:**
  - [x] Nothing crosses IPC as a thrown string; every reply is a `Result`.

#### AL-011 · Invoke channels: contracts, router, validation, trusted sender
- **Design:** §4, §6 · **Depends on:** AL-010
- **Scope:** `names.ts` (zod-free channel list for the preload) and `schemas.ts` (zod request/response per channel); `InvokeHandlers` mapped type forcing one main handler per channel; `handleInvoke` validates request and response and maps throws to `INTERNAL`; `ipcMain.handle` refuses frames that are not our renderer (dev server origin or the bundled `index.html`).
- **Acceptance criteria:**
  - [x] Adding a channel name without a schema or a handler fails `pnpm typecheck`.
  - [x] A request or response that breaks its schema returns `VALIDATION` / `INTERNAL`.
  - [x] Calls from any other frame (e.g. the Claude Design view) are refused.
- **How to add a channel:** name in `packages/contracts/src/domains/<domain>.names.ts` → contract in `domains/<domain>.schemas.ts` → handler in the domain's `createXHandlers` factory under `apps/desktop/src/main/<domain>/` (registered once in `src/main/ipc/handlers.ts`) → client hook in the renderer slice that needs it.

#### AL-012 · Event channels: main → renderer push
- **Design:** §6 Live events · **Depends on:** AL-011
- **Scope:** Event names and zod payload schemas for `agent:output`, `agent:stage`, `agent:subagent`, `agent:gate`, `agent:status`, `build:log`, `run:status`, `connections:changed`, `design:spec`, `toast` (payloads defined by the owning tickets; start with the envelope `{ ticketId, at, … }`). Main-side `emit(channel, payload)` that validates in development and sends to the main window's `webContents` only. Events carry no secrets.
- **Acceptance criteria:**
  - [ ] `emit` with an invalid payload throws in dev and logs + drops in production.
  - [ ] Events are delivered only to the trusted renderer frame.
  - [ ] Preload `on()` returns an unsubscribe function; unsubscribing stops delivery.
- **Tests:** main unit test for `emit` validation; renderer test that a fake bridge event reaches a subscriber.

#### AL-013 · Preload bridge
- **Depends on:** AL-011
- **Scope:** `window.agentLanes = { invoke, on }`, allow-listed from `names.ts`; bundled for the sandbox.
- **Acceptance criteria:**
  - [x] Unknown invoke channels resolve to a `VALIDATION` error; unknown event channels throw.
  - [x] The bridge exposes exactly `invoke` and `on` (checked by e2e).

#### AL-014 · Renderer IPC client
- **Depends on:** AL-013
- **Scope:** `invoke(channel, request)` in `@/shared/api` validating the envelope and payload; `unwrap()` + `IpcError` for TanStack Query.
- **Acceptance criteria:**
  - [x] A malformed reply or payload becomes an `INTERNAL` error, never an unchecked object.

#### AL-015 · Event hub in the app layer
- **Design:** §6 ("One subscription in app/ routes them into the Zustand stores") · **Depends on:** AL-012
- **Scope:** `app/entrypoint/EventHub` subscribes once per channel at start-up, validates payloads, and dispatches to registered store handlers (entities register `onAgentOutput`, `onStage`, …). Batches high-rate channels (`agent:output`, `build:log`) to at most one store update per animation frame (§12 Performance).
- **Acceptance criteria:**
  - [ ] Exactly one bridge subscription per channel for the app's lifetime.
  - [ ] 1,000 `agent:output` events within one frame cause one store commit.
  - [ ] An invalid payload is dropped and logged, and doesn't break the stream.
- **Tests:** unit test with fake bridge + fake rAF.

---

### E2 — Design system (`packages/tokens`, `packages/ui`)

Values and visuals come from §11 and artboards 6 and 7. Every primitive: RN components only, web
extras in `*.web.tsx`, keyboard focus shows the violet ring, targets ≥ 44 px, status never by
colour alone.

#### AL-020 · Tokens package (TS + CSS)
- **Design:** §11, artboard 7 · **Depends on:** AL-001
- **Scope:** `color`, `glass`, `radius`, `font`, `fontWeight`, `fontSize`, `space`, `shadow`, `motion`, `focusRing`, `minTarget` in TS; same values as `--al-*` CSS variables; glass-recipe credit kept in both files.
- **Acceptance criteria:**
  - [x] A test fails if a TS colour, radius or blur differs from its CSS variable.

#### AL-021 · Bundled fonts
- **Design:** §11 Type · **Depends on:** AL-020
- **Scope:** Ship Plus Jakarta Sans (500, 700, 800) and JetBrains Mono (400) inside the app (e.g. `@fontsource/*` woff2 imported in `main.tsx`); no network font loading (offline desktop app, CSP `font-src 'self'`).
- **Acceptance criteria:**
  - [ ] Board title renders in Plus Jakarta Sans 800 and ids/branches in JetBrains Mono with the network disabled.
  - [ ] Font licences (OFL) included in the packaged app's licence notices.

#### AL-022 · GlassPanel
- **Design:** §11 Glass, artboard 7 · **Depends on:** AL-020
- **Scope:** Levels `sm` 8 px, `md` 18 px, `xl` 40 px; white 62–72 % fill; inset top highlight; panel/modal radius.
- **Acceptance criteria:**
  - [x] Blur and fill match the tokens; renders in Electron (smoke screenshot).

#### AL-023 · Text primitives
- **Design:** §11 Type · **Depends on:** AL-021
- **Scope:** `Text` variants `display` (800), `title` (700, card titles, panel headings), `body` (500), `meta` (muted), `mono` (ids, branches, logs, diffs); `selectable` prop (logs need text selection — web file if RN-web's default is not enough, §13 risk).
- **Acceptance criteria:**
  - [ ] All text in the app goes through these variants (lint rule or review).
  - [ ] Body text on `bg` and `surface` meets 4.5:1.

#### AL-024 · Button
- **Design:** §11 Primitives, artboard 7 · **Depends on:** AL-023
- **Scope:** Variants `primary` (Claude violet), `strong` (ink), `secondary` (white + line), `soft` (Claude tint pill); sizes; optional leading icon; `loading` and `disabled`; hover lifts 3 px with the deeper shadow over 150–220 ms ease-out; pressed state; focus ring; min 44 px target.
- **Acceptance criteria:**
  - [ ] All four variants match artboard 7.
  - [ ] Keyboard: Tab focuses with the violet ring; Enter/Space activates.
  - [ ] `disabled` blocks presses and is announced (`aria-disabled`).

#### AL-025 · Pill, Badge, StatusBadge, IdChip
- **Design:** artboards 1, 6 · **Depends on:** AL-023
- **Scope:** `Pill` (tone: claude, ado, ok, attention, danger, neutral; optional dot); `Badge` (lane counts, amber variant); `StatusBadge` with fixed words — Running, Done, Queued, Needs you, Switching · next turn; `IdChip` (mono `#71273` on ADO tint).
- **Acceptance criteria:**
  - [ ] Every status pill carries a word, not only a colour.
  - [ ] Matches the "Status badges" block on artboard 6.

#### AL-026 · SegmentedControl and Switch
- **Design:** artboards 2, 3 · **Depends on:** AL-023
- **Scope:** `SegmentedControl` (Sprint/Search/No ticket; Low/Med/High/XHigh/Max; Output/Diff/…) with arrow-key navigation and `radiogroup` semantics; `Switch` with label and "Auto / Needs approval" side text.
- **Acceptance criteria:**
  - [ ] Arrow keys move selection; selected segment is white with the violet text where the artboard shows it.
  - [ ] Switch toggles with Space and exposes `role="switch"` + `aria-checked`.

#### AL-027 · TextField
- **Design:** artboards 2, 5 · **Depends on:** AL-023
- **Scope:** Single-line, multiline (job description), `secure` (PAT/API key: masked, no autocomplete, no spellcheck, never echoed into logs or state outside the form), search variant with leading icon; label, help text, error text.
- **Acceptance criteria:**
  - [ ] Secure fields clear their value from component state after submit.
  - [ ] Error text is linked with `aria-describedby`.

#### AL-028 · Card and ProgressBar
- **Design:** artboards 1, 6 · **Depends on:** AL-022
- **Scope:** `Card` (surface, radius 16, card shadow, optional border tone: selected violet, attention amber, danger red, muted for merged; optional footer band in attention/ado/danger/ok tint); `ProgressBar` (violet→sky gradient, green for merged).
- **Acceptance criteria:**
  - [ ] Card supports every border + footer combination on artboard 6.

#### AL-029 · Modal and Tabs
- **Design:** artboards 2, 3, 5 · **Depends on:** AL-022, AL-024
- **Scope:** `Modal` (glass xl, radius 28, header icon + title + subtitle, close button, footer slot; focus trap; Esc closes unless `blocking`; restores focus on close; backdrop blur); `Tabs` (pill tab bar as on the drill-in, optional trailing ↗ icon, status dot per tab as on Connections).
- **Acceptance criteria:**
  - [ ] Focus stays inside an open modal; Esc closes non-blocking modals only.
  - [ ] A `blocking` modal (first-run Connections) cannot be dismissed.

#### AL-030 · Toast and ToastHost
- **Design:** artboard 6 "Toast · error" · **Depends on:** AL-024
- **Scope:** `ToastHost` in `app/`; `toast({ tone, title, body, actions })`; error toast with icon, primary action (e.g. Reconnect) and Dismiss; stacking; auto-dismiss for info only; `aria-live`.
- **Acceptance criteria:**
  - [ ] Error toasts stay until acted on; info toasts auto-dismiss after 5 s.
  - [ ] Toasts can be raised from the main process through the `toast` event (AL-012).

#### AL-031 · Icons
- **Depends on:** AL-020
- **Scope:** One `Icon` primitive (lucide set via `react-native-svg`, which renders on web) for: plus, link, chevron, arrow-left, arrow-right, play, stop, hammer/build, branch/merge, external-link, refresh, search, check, close, lock, alert, pause.
- **Acceptance criteria:**
  - [ ] Icons inherit text colour and size; decorative icons are hidden from screen readers.

#### AL-032 · Component gallery (dev route)
- **Design:** artboards 6, 7 · **Depends on:** AL-023–AL-031
- **Scope:** A development-only page that renders the tokens sheet and every card state, for side-by-side checking against `docs/design/screens/06-card-states.png` and `07-design-tokens.png`. Excluded from production builds.
- **Acceptance criteria:**
  - [ ] Reachable in `pnpm dev` only.
  - [ ] Covers every primitive and every card state.

#### AL-033 · Accessibility checks
- **Design:** §11 Accessibility · **Depends on:** AL-032
- **Scope:** Unit test computing contrast for each text/background token pair in use (≥ 4.5:1 body, ≥ 3:1 large/UI); axe check of the gallery page in e2e; target-size audit.
- **Acceptance criteria:**
  - [ ] Contrast test passes for all used pairs (record any pair adjusted in Decisions).
  - [ ] No serious axe violations on the gallery, board and modals.

---

### E3 — Secrets, settings and Connections

#### AL-040 · Secret store (safeStorage)
- **Design:** §8 Storage · **Depends on:** AL-011
- **Scope:** Main-only `SecretStore`: `put(id, secret)`, `get(id)`, `delete(id)`, `list()` (ids + metadata only). Encrypted with `safeStorage.encryptString` (DPAPI / Keychain / libsecret) into `<userData>/secrets.json`; refuse to store if `safeStorage.isEncryptionAvailable()` is false (no plaintext fallback). Only other main services can read; no IPC channel returns a secret.
- **Acceptance criteria:**
  - [ ] File on disk contains no plaintext token (test greps the file).
  - [ ] No contract schema contains a secret field in any response (contract test).
  - [ ] Corrupt file → secrets treated as missing, user prompted to reconnect, nothing crashes.
- **Tests:** main unit tests with a fake `safeStorage`.

#### AL-041 · Settings store and UI prefs
- **Design:** §6 Persisted UI prefs, §8, R5 · **Depends on:** AL-011
- **Scope:** electron-store (app data, written only by the app) with a versioned zod schema + migrations: repos (path, name, base branch, worktree root, build/run overrides, max concurrent agents), defaults (model, effort, stage gates, skills), build queue size, UI prefs (last repo, last sprint, collapsed lanes, embed mode per ticket). IPC `settings:get`, `settings:update` (partial, validated). Renderer Zustand `persist` adapter backed by these channels for UI prefs.
- **Acceptance criteria:**
  - [ ] Nothing in the app reads a user-edited file; settings change only through the UI.
  - [ ] Schema migration from v1 to v2 is covered by a test.
  - [ ] Collapsed lanes survive a restart.

#### AL-042 · Connections service and IPC
- **Design:** §8 · **Depends on:** AL-040, AL-041
- **Scope:** Main `ConnectionsService` holding ADO orgs (url, default project, identity, PAT ref), Claude (mode: existing login | API key), MCP servers. Channels: `connections:list` (name, kind, identity, expiry, status ok/error/untested, missing scopes), `connections:test` (draft or saved), `connections:save`, `connections:replace`, `connections:remove`. Event `connections:changed`. PATs go straight from the save request into SecretStore; the response carries a masked tail only (`••••••••7Fq2`).
- **Acceptance criteria:**
  - [ ] No response or event contains a full token (contract test + e2e IPC spy).
  - [ ] Remove deletes the secret and any session env that used it on next launch.

#### AL-043 · ADO connection test
- **Design:** §8 ("tested with GET /_apis/connectionData … which required scopes are missing") · **Depends on:** AL-042, AL-060
- **Scope:** `GET {org}/_apis/connectionData` → signed-in identity; scope probes with read calls per area — Work Items (`_apis/wit/wiql` on a trivial query), Code (`_apis/git/repositories?$top=1`), Build (`_apis/build/builds?$top=1`); a 401/403 marks that scope missing. Write scopes cannot be proven without writing: mark them "verified on first write" and map a later 403 to `ADO_SCOPE_MISSING`. Load projects for the Default project dropdown after a successful test.
- **Acceptance criteria:**
  - [ ] Saved row shows "signed in as <name>" and masked token, as on artboard 5.
  - [ ] A PAT without Build (read) shows the Build scope chip as missing.
  - [ ] Expiry shown when known (Q10).
- **Tests:** MSW handlers for each probe outcome.

#### AL-044 · Claude connection
- **Design:** §7, §8, Q4 · **Depends on:** AL-042
- **Scope:** Detect an existing Claude Code login (start a throwaway SDK query and read `accountInfo()` / the auth status message, or the documented auth probe) and offer "Use my Claude Code login"; or store an API key (passed to sessions as `ANTHROPIC_API_KEY` env, AL-100). Test = one-token request (`maxTurns: 1`, tiny prompt) and report account/org.
- **Acceptance criteria:**
  - [ ] With a logged-in Claude Code on the machine, the tab shows "Connected · using your Claude Code login" with no key entered.
  - [ ] An invalid API key shows a clear error and stays red.

#### AL-045 · MCP server entries
- **Design:** §7 MCP servers, §8 · **Depends on:** AL-042
- **Scope:** Add/edit/remove MCP servers: name, transport (stdio command + args | HTTP/SSE URL), optional token (secret, injected as env or header at launch). Built-in entry for the ADO MCP server per connected org (AL-108). Test = start the server and list its tools.
- **Acceptance criteria:**
  - [ ] A server whose command fails to start shows the error output in the row.
  - [ ] Tokens for MCP servers are stored in SecretStore, never in settings.

#### AL-046 · Connections modal UI
- **Design:** §8, artboard 5, R4 · **Depends on:** AL-043, AL-044, AL-045, AL-027, AL-029
- **Scope:** `features/connect-ado`, `connect-claude`, `connect-mcp` + `widgets`-free composition in the modal: header ("Tokens are encrypted on this computer and never shown again after you save them"), tabs Azure DevOps / Claude / MCP servers with status dots, saved rows (Connected pill, url · signed in as · masked token · expires, Replace / Remove), "Add an organisation" form (Organisation URL, Default project "Loaded after the token is tested", PAT + Test connection, scope chips, help text naming User settings › Personal access tokens), footer lock note + Cancel + Save connections. Opens from the header and from any reconnect action, focused on the right row.
- **Acceptance criteria:**
  - [ ] Matches artboard 5.
  - [ ] Save is disabled until the draft row has passed Test connection.
  - [ ] Opening via a Reconnect toast lands on that org's row with the PAT field focused.

#### AL-047 · First-run flow and repo picker
- **Design:** §8 ("opens automatically on first run and blocks the board"), §5 Processes example · **Depends on:** AL-046, AL-081
- **Scope:** `processes/first-run`: if no ADO org or no Claude connection → blocking Connections modal → "Pick a repo" step using the native folder dialog (AL-081) → board for that repo.
- **Acceptance criteria:**
  - [ ] Fresh profile: board is not reachable until one ADO org and Claude are connected and a repo is chosen.
  - [ ] Second launch goes straight to the board for the last repo.

#### AL-048 · Credential failure handling
- **Design:** §8 last bullet, §13 PAT risk · **Depends on:** AL-046, AL-100, AL-030
- **Scope:** Any 401 from ADO (client or ADO MCP inside a session) marks that org red, pauses only the agents whose work items belong to that org (interrupt + hold their input queue), and raises an error toast with Reconnect. After a successful reconnect, paused sessions resume with a short "Connection restored" user turn.
- **Acceptance criteria:**
  - [ ] Agents on another org keep running.
  - [ ] Reconnect → resume works without restarting the app.

---

### E4 — Azure DevOps (`packages/ado-client`, main-process service)

#### AL-060 · ado-client core
- **Design:** §7 · **Depends on:** AL-001
- **Scope:** `createAdoClient({ orgUrl, pat, fetch })`: Basic auth header from the PAT, `api-version=7.1`, JSON + zod-validated responses, continuation-token paging, 429/503 retry honouring `Retry-After` (max 3), error mapping (401 → `ADO_UNAUTHORIZED`; 403 or the 203-login-page case → `ADO_SCOPE_MISSING`), request timeout, and redaction of the auth header in any error.
- **Acceptance criteria:**
  - [ ] Every exported call returns `Result<T>`.
  - [ ] No error message or log line contains the PAT (test).
- **Tests:** MSW for paging, retry, each error class.

#### AL-061 · Sprints (iterations)
- **Design:** artboard 1 header ("Sprint 42 · 7 – 20 Oct") · **Depends on:** AL-060
- **Scope:** Teams for a project; iterations for a team (`_apis/work/teamsettings/iterations`), current one via `$timeframe=current`; DTO `{ id, name, path, start, finish }`.
- **Acceptance criteria:**
  - [ ] Current sprint is pre-selected; past and future sprints are selectable.

#### AL-062 · Work items: sprint list, search, get
- **Design:** artboard 2, R6 · **Depends on:** AL-060
- **Scope:** WIQL for items in an iteration path (stories, bugs, tasks; configurable types) → batch `workitems?ids=` with fields `System.Id, Title, WorkItemType, State, AssignedTo, IterationPath, Description, AcceptanceCriteria`; search by numeric id or title `CONTAINS`; DTO includes state category for colouring and the web URL ("Open in Azure DevOps ↗").
- **Acceptance criteria:**
  - [ ] Sprint list returns ≥ 200 items with paging.
  - [ ] Searching "71273" or "frmJobControl" finds #71273.

#### AL-063 · Work item write-back (comments, state)
- **Design:** §7 ADO write-back · **Depends on:** AL-060
- **Scope:** Add comment (Comments API); optional state transition (only when enabled in settings; default off).
- **Acceptance criteria:**
  - [ ] A comment posted by the app is visible in ADO with a recognisable prefix ("Agent Lanes ·").

#### AL-064 · Pull requests: create, link, checks
- **Design:** §7, §9 step 5 alternative, artboard 6 "PR open" · **Depends on:** AL-060
- **Scope:** Create PR (source = ticket branch, target = base branch, title/description, `workItemRefs`); get PR (status, merge status); checks = policy evaluations + build statuses → `{ passed, total, failing[] }`; complete/abandon detection for Done.
- **Acceptance criteria:**
  - [ ] Card shows "PR !10612 · 3 / 4 checks".
  - [ ] A completed PR moves the ticket to Done (via AL-181).

#### AL-065 · Main ADO service, IPC and MSW fixtures
- **Depends on:** AL-061–AL-064, AL-042
- **Scope:** `AdoService` picks the client per org from ConnectionsService; channels `ado:listSprints`, `ado:listWorkItems`, `ado:searchWorkItems`, `ado:getWorkItem`, `ado:getComments`, `ado:createPullRequest`, `ado:getPullRequest`. Shared MSW handler set + fixture data (sprint 42, items #71273, #71330, #71335, #71341 from the artboards) used by unit, integration and e2e tests.
- **Acceptance criteria:**
  - [ ] Every channel has contract schemas and a handler test.

#### AL-066 · Renderer ADO queries and refetch policy
- **Design:** §6 ("refetches on window focus and every 60 s while the board is open") · **Depends on:** AL-065
- **Scope:** `entities/ado-work-item` (model + `WorkItemChip`), query hooks `useSprints`, `useWorkItems(sprint)`, `useWorkItemSearch(q)`, `useWorkItem(id)`, `usePullRequest(id)`; key factory (`['ado','workItem',id]` etc.); `refetchInterval: 60_000` only while the board is visible.
- **Acceptance criteria:**
  - [ ] No ADO polling while the window is hidden or minimised.

---

### E5 — Git and worktrees (main-process service)

#### AL-080 · Git runner
- **Depends on:** AL-001
- **Scope:** `git(args, { cwd })` via `execFile` (no shell, so no injection), timeout, typed errors, porcelain parsers (`status --porcelain=v2`, `worktree list --porcelain`, `rev-list --left-right --count`); minimum git version check (≥ 2.38) on start-up with a clear message.
- **Acceptance criteria:**
  - [ ] Branch names with spaces or quotes cannot break a command (test).
- **Tests:** against temp repos (AL-221 kit).

#### AL-081 · Repo registry and folder picker
- **Design:** §8 ("Repo paths are picked with a native folder dialog"), artboard 1 Repo dropdown · **Depends on:** AL-080, AL-041
- **Scope:** `repos:add` opens `dialog.showOpenDialog` in main, validates a git work tree, detects default branch (`origin/HEAD`, fallback `main`), stores the repo; `repos:list`, `repos:remove`; worktree root defaults to `<repo>/../.agent-lanes/` (§9).
- **Acceptance criteria:**
  - [ ] Picking a non-git folder shows an error and stores nothing.

#### AL-082 · Branch and worktree naming
- **Design:** §9, artboard 2 Workspace ("Worktree 71273-cutover-frmjobcontrol-to") · **Depends on:** —
- **Scope:** Pure function `<id>-<slug>` from the work item title: lowercase ASCII, words joined by `-`, max 32 chars cut on a word boundary where possible, dedupe with `-2`, `-3` against existing branches; no-ticket tickets use `nt-<yyyymmdd>-<slug>`; user can edit the name in the modal, re-validated with `git check-ref-format`. Sub-branches `sub/<ticket-id>-<name>`.
- **Acceptance criteria:**
  - [ ] Table-driven tests cover unicode, punctuation, long titles and collisions.

#### AL-083 · Create the ticket worktree
- **Design:** §9 step 1 · **Depends on:** AL-081, AL-082
- **Scope:** `git fetch origin <base>` then `git worktree add <root>/<id> -b <branch> origin/<base>` (or local base when offline); refuse if the path exists and is not ours; record path + branch on the ticket.
- **Acceptance criteria:**
  - [ ] Two tickets get two worktrees and never share a branch (R8).
  - [ ] Failure leaves no half-created worktree or branch.

#### AL-084 · Sub-agent worktrees (WorktreeCreate hook)
- **Design:** §9 step 3 · **Depends on:** AL-083, AL-100
- **Scope:** Register SDK `hooks.WorktreeCreate` in each session (Decision D9): create `sub/<ticket>-<name>` off the ticket branch at `<root>/<id>--<name>` and return `worktreePath`; `WorktreeRemove` keeps the worktree (removed only on Archive). Read-only sub-agents (explore, reviewer) are not isolated and share the ticket worktree. Record each sub-branch on the ticket.
- **Acceptance criteria:**
  - [ ] Two writer sub-agents edit in parallel without touching each other's files.
  - [ ] Sub-branches appear in the Sub-branches panel with ahead counts.

#### AL-085 · Branch status
- **Design:** artboard 3 Sub-branches ("4 ahead · Ready") · **Depends on:** AL-083
- **Scope:** `branches:status(ticketId)` → ticket branch vs base, each sub-branch vs ticket branch: ahead/behind, dirty, ready (= clean and its sub-agent finished). Query key `['branches', ticketId]`; refreshed on `agent:subagent` completion and after merges.
- **Acceptance criteria:**
  - [ ] A dirty sub-worktree is never "Ready".

#### AL-086 · Merge sub-branches → ticket branch
- **Design:** §9 step 4, R9 · **Depends on:** AL-084, AL-085
- **Scope:** Merge every ready sub-branch into the ticket branch in creation order (`--no-ff`); stop at the first conflict, leave the merge in progress in the ticket worktree, return `MERGE_CONFLICT` with the file list; offer "Hand to lead agent" (user turn listing conflicts) or "I'll resolve it" (open files in the user's editor).
- **Acceptance criteria:**
  - [ ] Successful merges invalidate `['branches', id]` and `['ado','workItem',id]`.
  - [ ] After a conflict, nothing past the conflicting branch is merged.

#### AL-087 · Merge worktree → main
- **Design:** §9 step 5, R9, §13 risk, Q1, Q2 · **Depends on:** AL-085
- **Scope:** Confirm modal naming source and target; warning when QA has not passed; refuse with `GIT_DIRTY` when the worktree has uncommitted changes; merge into the base branch in the main checkout and push; optional block until the PR is approved (setting). Behaviour after Q1 is answered may switch this to "always via PR".
- **Acceptance criteria:**
  - [ ] Cannot merge with uncommitted changes.
  - [ ] Card moves to Done with "Merged into main · 15:20".

#### AL-088 · Archive
- **Design:** §9 step 6 · **Depends on:** AL-083
- **Scope:** User-chosen Archive removes the ticket worktree and its sub-worktrees (`git worktree remove`, then prune), optionally deletes merged branches; handles Windows long paths and locked files (retry, report partial removals); ticket record moves to an archive list.
- **Acceptance criteria:**
  - [ ] Never runs automatically.
  - [ ] Refuses when a worktree has unmerged commits unless the user confirms a second time.

#### AL-089 · Diff provider
- **Design:** artboard 3 Diff tab · **Depends on:** AL-083
- **Scope:** `git:diff(ticketId, { against: base | sub-branch })` → files with status and stats, and per-file unified diff on demand (size-capped).
- **Acceptance criteria:**
  - [ ] Binary and very large files show a placeholder, not raw content.

#### AL-090 · Start-up reconciliation
- **Design:** §6 last bullet · **Depends on:** AL-083, AL-101
- **Scope:** On launch, read `git worktree list --porcelain` for each repo and match ticket records; rebuild tickets with their stage, model/effort and session id; flag orphans (record without worktree → "Worktree missing"; worktree under our root without record → offer "Adopt" or "Ignore").
- **Acceptance criteria:**
  - [ ] Restarting the app shows the same board as before, with sessions resumable.

---

### E6 — Agent sessions (Claude Agent SDK, main process)

API facts used here were read from `@anthropic-ai/claude-agent-sdk` 0.3.292 type definitions
(`sdk.d.ts`) on 2026-10-07. Model IDs per Decision D10.

#### AL-100 · Session manager core
- **Design:** §4 Session manager, §7 · **Depends on:** AL-083, AL-044
- **Scope:** One `query({ prompt: AsyncIterable<SDKUserMessage>, options })` per ticket in streaming-input mode, with an input queue the app pushes into. Options: `cwd` = ticket worktree; `projectConfigRoot` = repo main checkout (Decision D12); `model`; `effort`; `thinking: { type: 'adaptive' }`; `settingSources: ['user', 'project', 'local']`; `includePartialMessages: true`; `env` with the connection's credentials; `abortController`; `mcpServers` (AL-103, AL-108); `hooks` (AL-084); `canUseTool`/`permissionMode` (AL-109); `resume` when a session id exists (AL-110). First user turn = job description + work item summary + selected skills + stage protocol (AL-103). API surface for the rest of E6: `send(ticketId, message)`, `interrupt`, `setModel`, `setEffort`, `stop`, `status`.
- **Acceptance criteria:**
  - [ ] Two tickets run concurrently in different worktrees without cross-talk.
  - [ ] Closing a ticket's session releases its process (no orphan `claude` processes; check Task Manager in AL-213).
  - [ ] The SDK's native binary is found in dev and in the packaged app (AL-007).
- **Tests:** with the fake SDK from AL-221.

#### AL-101 · Ticket records
- **Design:** §6, R2, Decision D8 · **Depends on:** AL-041
- **Scope:** App-written JSON per ticket in `<userData>/tickets/<repoKey>/<ticketId>.json`: ADO ref, repo, branch, worktree path, sub-branches, stage + stage timestamps, gates, model, effort, skills, session id, last build/run, design link + spec versions (E11). Atomic write (temp + rename), zod-validated on read, debounced writes.
- **Acceptance criteria:**
  - [ ] Killing the app mid-write never corrupts a record (test with interrupted write).
  - [ ] Nothing is written inside a worktree (keeps it clean for GIT_DIRTY).

#### AL-102 · Output normalisation and transcript buffer
- **Design:** §6 Live events, artboard 3 Output · **Depends on:** AL-100, AL-012
- **Scope:** Map `SDKMessage`s to an `AgentOutputEvent` union: `text-delta` (partial assistant text), `text`, `tool` (Read/Edit/Write/Bash/Grep/Glob/Agent→"Spawn"/MCP, with a one-line mono detail and stats like `+214 −0`, `1,842 lines`, `0 errors · 2 warnings`), `tool-result` (summary only), `system` ("Plan approved by Kyle · moved to Implementing"), `result` (usage, cost, duration). Keep a per-ticket ring buffer (e.g. last 5,000 events) in main; `agent:getTranscript(ticketId)` returns it so a reloaded renderer or newly opened drill-in can backfill; older history from `getSessionMessages()`.
- **Acceptance criteria:**
  - [ ] Every tool row on artboard 3 can be produced from real SDK messages.
  - [ ] Opening a drill-in mid-run shows prior output, then continues live with no gap or duplicate.

#### AL-103 · Stage protocol: `agent_lanes` MCP server
- **Design:** §7 Stage tracking · **Depends on:** AL-100
- **Scope:** In-process server via `createSdkMcpServer({ name: 'agent_lanes', tools: [...] })` with `tool()` definitions: `set_stage({ stage, summary })`, `report_activity({ text, progress })` (drives the card's activity line and progress bar). Allowed without permission prompts. Stage protocol text appended to the system prompt: report each stage change; Code review and QA may send work back to Implementing (§9 diagram loop). Emits `agent:stage`.
- **Acceptance criteria:**
  - [ ] A `set_stage` call moves the card within one frame of the event.
  - [ ] Invalid stage transitions are rejected with a tool error the agent can read.

#### AL-104 · Stage gates
- **Design:** §9 step 2, artboard 2 Stage gates, artboard 6 "Needs approval" · **Depends on:** AL-103
- **Scope:** When `set_stage` targets a stage whose *entry* is gated (defaults: Planning approval before Implementing; Create PR approval), the tool call does not return until the user decides: Approve → tool result "approved"; Request changes → tool result with the user's note. Card shows "Needs you · approve plan"; `agent:gate` event; `agent:resolveGate` channel. Gates are per ticket and editable from the drill-in.
- **Acceptance criteria:**
  - [ ] While waiting, the session uses no tokens and the card is amber.
  - [ ] Turning a gate off while waiting releases it as approved.

#### AL-105 · Messages, skills and pause
- **Design:** §7 Skills, artboard 3 composer · **Depends on:** AL-100
- **Scope:** `agent:send({ ticketId, text, priority })` pushes an `SDKUserMessage` (`priority: 'next'` default; `'now'` for "steer now"). Skill chips send `/skill-name` as the next user turn so they behave as in the terminal. Pause = `interrupt()`; the input queue holds further messages until Resume.
- **Acceptance criteria:**
  - [ ] A message sent mid-turn is delivered without killing the turn.
  - [ ] `/code-review` from a chip runs the skill exactly as typed in the terminal.

#### AL-106 · Live model and effort change
- **Design:** R7, §7, artboard 6 "Model switching" · **Depends on:** AL-100
- **Scope:** `agent:setModel` → `Query.setModel(id)`; `agent:setEffort` → `Query.applyFlagSettings({ effortLevel })`. Ticket shows "Switching · applies next turn" until the next assistant message reports the new model (or the next turn starts), then clears. "Apply model now" = interrupt, apply, then a "continue" user turn.
- **Acceptance criteria:**
  - [ ] Opus → Sonnet mid-run shows "Opus → Sonnet · High" then clears when applied.
  - [ ] Effort changes persist to the ticket record.

#### AL-107 · Sub-agent tracking
- **Design:** artboard 3 Sub-agents, §6 `agent:subagent` · **Depends on:** AL-102
- **Scope:** Build the tree from Agent/Task tool uses and `parent_tool_use_id`, `SDKTaskStarted/Updated/Progress/Notification` messages, and `SubagentStart/Stop` hooks: name, agent type, model · effort, status (Queued/Running/Done/Failed), one-line activity, tokens, branch or "read-only". Optional `forwardSubagentText` for a nested transcript.
- **Acceptance criteria:**
  - [ ] Panel counts ("2 running · 1 done · 1 queued") match the SDK's task states.

#### AL-108 · MCP injection and status
- **Design:** §7 MCP servers, artboard 1 "MCP online" · **Depends on:** AL-100, AL-045
- **Scope:** Each session gets `agent_lanes` (AL-103), the ADO MCP server for the work item's org (official Azure DevOps MCP server, PAT as env), and the user's MCP servers. `mcpServerStatus()` aggregated into the header pill (all online / N failing); `reconnectMcpServer` on failure.
- **Acceptance criteria:**
  - [ ] The agent can read and comment on its own work item through the ADO MCP server.
  - [ ] A failing server turns the pill amber with the server name on hover.

#### AL-109 · Permission policy for headless sessions
- **Design:** §4 (headless sessions), Q9 · **Depends on:** AL-100 · **Policy:** the proposed default (Decision D18), configurable in settings
- **Scope:** Choose `permissionMode` and an allow-list (proposal: `acceptEdits`, plus Bash allow-list for git read commands, build and test commands of the repo); everything else goes through `canUseTool`, which raises "Needs you · permission" on the card with Allow once / Allow for this ticket / Deny.
- **Acceptance criteria:**
  - [ ] No session ever blocks on an invisible prompt.
  - [ ] Decisions are logged in the ticket's output.

#### AL-110 · Crash recovery
- **Design:** §12 ("restarted from its saved session id in the same worktree"), artboard 6 toast · **Depends on:** AL-100, AL-101
- **Scope:** Detect session loss (stream error, process exit, no output past a watchdog while "running") → `SESSION_LOST` → toast "MCP bridge lost the session · cc-71288 stopped responding. The worktree is intact." with Reconnect / Dismiss; Reconnect = new `query()` with `resume: sessionId`, same cwd. Auto-retry once before asking. Never deletes the worktree.
- **Acceptance criteria:**
  - [ ] Killing the `claude` process mid-run leads to a resumed session with the history intact.

#### AL-111 · Concurrency cap and Queued lane
- **Design:** §13 risk ("per-repo cap on concurrent agents, and a queued lane"), Q5 · **Depends on:** AL-100
- **Scope:** Per-repo max running agents (setting, default 3); extra launches land in Queued with "Waiting for a free slot"; FIFO start when a slot frees; manual "Start now" overrides.
- **Acceptance criteria:**
  - [ ] Never more running sessions per repo than the cap.

#### AL-112 · Build result as next-turn context
- **Design:** §10 last bullet · **Depends on:** AL-100, AL-132
- **Scope:** When a build finishes, push an `SDKUserMessage` with `shouldQuery: false` (Decision D11) containing the result summary and the first N errors, so it rides along with the agent's next turn without starting one.
- **Acceptance criteria:**
  - [ ] After a user-started failed build, the agent's next turn mentions the errors without being told.

#### AL-113 · Usage, tokens and session pill
- **Design:** artboard 3 ("Session cc-71273 · 1h 12m · 412k tokens"), Lead agent "212k tokens" · **Depends on:** AL-102
- **Scope:** Aggregate usage from result/assistant messages per session and per sub-agent; elapsed time; context usage via `getContextUsage()`; cost (shown in a tooltip only).
- **Acceptance criteria:**
  - [ ] Totals match the SDK's result usage within rounding.

#### AL-114 · Skill discovery
- **Design:** artboard 2 Skills, artboard 3 shortcuts · **Depends on:** AL-100
- **Scope:** `skills:list(repo)` from `supportedCommands()` of a session started with the repo's config (cached per repo, refreshed on demand); returns name + description; filters to skills.
- **Acceptance criteria:**
  - [ ] The repo's own `.claude/skills` and the user's skills both appear.

#### AL-115 · ADO write-back on stage change
- **Design:** §7 ADO write-back · **Depends on:** AL-103, AL-063
- **Scope:** On each stage change post a short comment ("Agent Lanes · Implementing — plan approved by Kyle"); rate-limited; off switch per repo.
- **Acceptance criteria:**
  - [ ] One comment per stage change, never duplicated after a resume.

---

### E7 — Build and run (main-process service)

#### AL-130 · Build/run command detection and overrides
- **Design:** §10 · **Depends on:** AL-081
- **Scope:** Detect per repo: `.sln`/`.csproj` → `dotnet build <sln> -c Debug` / `dotnet run --project <proj>`; `package.json` → its `build` / `start` (or `dev`) scripts with the repo's package manager. Overrides stored per repo in settings (edited in AL-146), never in a file.
- **Acceptance criteria:**
  - [ ] OnSite Companion resolves to `dotnet build OnSite.sln -c Debug`.

#### AL-131 · Job queue
- **Design:** §10 ("at most 2 at once by default") · **Depends on:** AL-011
- **Scope:** FIFO queue with concurrency from settings, per-worktree serialisation (one job per worktree at a time), cancellation, `build:queued` status.
- **Acceptance criteria:**
  - [ ] Third concurrent build waits; cancelling a queued job removes it.

#### AL-132 · Build job and log parsing
- **Design:** §10, artboard 6 "Build failed" · **Depends on:** AL-130, AL-131, AL-012
- **Scope:** Spawn in the worktree, stream `build:log` lines (batched), parse MSBuild (`file(line,col): error CS0246: …`) and tsc/eslint formats into diagnostics; result `ok` or `BUILD_FAILED` with counts; store "Last build 14:02 · succeeded" on the ticket.
- **Acceptance criteria:**
  - [ ] Card shows "Build failed · 3 errors" and the first error as activity.

#### AL-133 · Run job, port and URL
- **Design:** §10 Run · **Depends on:** AL-132
- **Scope:** Build if the last build is stale, then start as a child process; web projects get a free port (`ASPNETCORE_URLS` / `PORT`), detect the listening URL from output, card shows "Running · localhost:5080" (click opens the browser); desktop exe launches its own window. `run:status` events.
- **Acceptance criteria:**
  - [ ] Two tickets run the same web app side by side on different ports.

#### AL-134 · Stop and process-tree kill
- **Design:** §10 Stop · **Depends on:** AL-133
- **Scope:** Kill the whole tree (`taskkill /PID <pid> /T /F` on Windows, process group elsewhere); app quit stops every run it started.
- **Acceptance criteria:**
  - [ ] No orphan `dotnet` or `node` processes after Stop or quit.

#### AL-135 · Build log tab
- **Design:** artboard 3 tabs, §10 · **Depends on:** AL-132, AL-029
- **Scope:** Virtualised mono log, warnings amber and errors red, "jump to next error", copy, follow-tail toggle.
- **Acceptance criteria:**
  - [ ] 50,000-line log scrolls smoothly.

---

### E8 — App shell and board (artboard 1)

#### AL-140 · App router and lazy pages
- **Design:** §5 App layer, §12 Performance · **Depends on:** AL-003
- **Scope:** Typed in-app router (Decision D13): `board`, `ticket/:id`, `ticket/:id/design`; history back/forward (mouse buttons, Alt+←); pages lazy-loaded behind Suspense.
- **Acceptance criteria:**
  - [ ] Each page is its own chunk.

#### AL-141 · Agent ticket entity and store
- **Design:** §6 Live client state · **Depends on:** AL-015, AL-101
- **Scope:** `entities/agent-ticket`: model types, Zustand store keyed by ticket id (stage, activity, progress, model/effort/switching, gate, build/run, PR, sub-agent counts, needs-you reasons), selectors per lane and per ticket so a streaming ticket re-renders only itself; event handlers registered with the hub.
- **Acceptance criteria:**
  - [ ] A burst of output on one ticket does not re-render other cards (React Profiler test).

#### AL-142 · Board header
- **Design:** artboard 1 · **Depends on:** AL-141, AL-066, AL-024, AL-025, AL-081
- **Scope:** Logo + "Agent Lanes"; Repo dropdown (registered repos + "Add repo…"); Sprint dropdown; live pills (`N running`, `N need you`, `N queued`, MCP status); Connections icon button; "+ New agent ticket". Sub-header line "Sprint 42 · 7 – 20 Oct · 8 agent tickets", title "Agent board", legend.
- **Acceptance criteria:**
  - [ ] Counts update live from the store; "need you" pill opens a filtered view or scrolls to the first amber card.

#### AL-143 · Lanes
- **Design:** artboard 1, artboard 6 "Empty lane" · **Depends on:** AL-141
- **Scope:** Lanes Queued, Planning, Implementing, Code review, QA, Create PR, then a collapsed vertical Done lane ("7 · Done · merged this sprint", expandable). Count badge per lane (amber when any card needs the user). Empty-lane copy per lane ("Nothing in QA · Tickets land here once code review passes."). Collapsible lanes persisted (AL-041). Horizontal scroll below the min width.
- **Acceptance criteria:**
  - [ ] Matches artboard 1 at 1440 × 960.

#### AL-144 · AgentTicketCard and its states
- **Design:** artboard 6, R6 · **Depends on:** AL-141, AL-025, AL-028
- **Scope:** `entities/agent-ticket/ui/AgentTicketCard`: IdChip + ADO state, title, activity row (violet dot), progress bar, footer "Model · Effort" + "N sub-agents", optional status band. States: Running, Selected, Needs approval, Model switching, Build failed, QA gap, PR open, Merged; plus Queued ("Waiting for a free slot") and Needs permission (AL-109). Click opens the drill-in; keyboard focusable.
- **Acceptance criteria:**
  - [ ] Each state on artboard 6 reproduced in the gallery (AL-032) and from real events.

#### AL-145 · Live dock
- **Design:** artboard 1 bottom bar · **Depends on:** AL-141
- **Scope:** Glass dock with `Live` pill, the latest three timestamped events across tickets (amber for needs-you events), "Sub-agents N", "Builds N"; clicking an event opens its ticket.
- **Acceptance criteria:**
  - [ ] Dock updates no more than once per frame under load.

#### AL-146 · Settings panel (repo and defaults)
- **Design:** §10 ("override them in the repo's settings panel"), R5 — no artboard; build with E2 primitives · **Depends on:** AL-041, AL-130, AL-029
- **Scope:** Per repo: base branch, worktree root, build/run commands, max concurrent agents, ADO write-back on/off. Global: default model/effort, default gates, default skills, build queue size, ADO state transitions on/off. Opened from the Repo dropdown and from a header menu.
- **Acceptance criteria:**
  - [ ] Every setting the app uses is editable here or in Connections; no other place.

---

### E9 — New agent ticket (artboard 2)

#### AL-160 · New-ticket modal shell and form state
- **Design:** artboard 2, §1 goal ("under a minute") · **Depends on:** AL-029
- **Scope:** `processes/new-ticket` with `features/create-ticket`: two-column modal, `useReducer` form state, validation, Cancel, "Launch agent →", footer summary ("Launch starts a headless Claude Code session in its own worktree via the MCP bridge. Linked to #71273. Opus · XHigh.").
- **Acceptance criteria:**
  - [ ] Keyboard-only path from open to launch works.

#### AL-161 · Work item picker
- **Design:** artboard 2 left column · **Depends on:** AL-160, AL-066
- **Scope:** Segmented Sprint 42 / Search / No ticket; search field "Search by ID or title" (debounced); radio list rows (id, title, "Story · Active"); "Optional" label; items already running show their lane instead of a radio.
- **Acceptance criteria:**
  - [ ] "No ticket" hides ADO fields and uses `nt-` naming.

#### AL-162 · Job description and skill chips
- **Design:** artboard 2 · **Depends on:** AL-160, AL-114
- **Scope:** "What should the agent do?" multiline field (prefilled from the work item's description/acceptance criteria as a quoted block the user can edit); Skills chips (mono, toggle, violet when selected) from AL-114, defaults from settings.
- **Acceptance criteria:**
  - [ ] Selected skills are passed to the session and listed in its first turn.

#### AL-163 · Model and effort pickers
- **Design:** artboard 2 right column · **Depends on:** AL-160, AL-026
- **Scope:** Model cards Opus "Deepest reasoning", Sonnet "Balanced", Haiku "Fast + light"; Effort segmented Low/Med/High/XHigh/Max with "Changeable any time"; defaults from settings.
- **Acceptance criteria:**
  - [ ] Model card choice maps to the IDs in Decision D10.

#### AL-164 · Workspace preview and stage gates
- **Design:** artboard 2 · **Depends on:** AL-160, AL-082
- **Scope:** Workspace table (Repo, Base, Worktree — editable, validated); Stage gates list with five switches, defaults Planning + Create PR "Needs approval".
- **Acceptance criteria:**
  - [ ] Invalid worktree names block Launch with a reason.

#### AL-165 · Launch
- **Design:** §9 step 1 · **Depends on:** AL-161–AL-164, AL-083, AL-100, AL-111
- **Scope:** Create worktree → write ticket record → start session (or queue) → card in Planning (or Queued) → modal closes, board highlights the new card. Errors map to recovery (AL-211).
- **Acceptance criteria:**
  - [ ] From a sprint item to a running Planning card in under a minute of user time.

---

### E10 — Ticket drill-in (artboard 3)

#### AL-170 · Ticket page frame
- **Design:** artboard 3 · **Depends on:** AL-140, AL-141
- **Scope:** Top bar (← Board, repo / #id breadcrumb, session pill); meta chips (#id, "User story · Active · Sprint 42 · Kyle Richards", "Open in Azure DevOps ↗"); title; tab bar Output / Diff / Build log / ADO / Claude Design ↗; right column for sub-agents. Error boundaries per panel (AL-210).
- **Acceptance criteria:**
  - [ ] Layout matches artboard 3 at 1440 wide; right column stacks under 1200.

#### AL-171 · Stage stepper and gate actions
- **Design:** artboard 3 stepper, §9 · **Depends on:** AL-104, AL-170
- **Scope:** Five steps: done (check + duration "12m"), current (number + "46%"), upcoming; gated step shows Approve / Request changes when waiting; gate toggles per stage.
- **Acceptance criteria:**
  - [ ] Approving here and on the card are the same action and stay in sync.

#### AL-172 · Agent panel (model and effort)
- **Design:** artboard 3 Agent panel, R7 · **Depends on:** AL-106, AL-170
- **Scope:** `features/change-model`: model segmented (Opus/Sonnet/Haiku), effort pills (Low…Max), switching state.
- **Acceptance criteria:**
  - [ ] Change shows "switching" until applied (AL-106).

#### AL-173 · Worktree panel (Build, Run, Stop)
- **Design:** artboard 3, R8 · **Depends on:** AL-134, AL-170
- **Scope:** `features/build-run`: branch name, Build / Run (primary) / Stop, "Last build 14:02 · succeeded", run status/URL; available at every stage.
- **Acceptance criteria:**
  - [ ] Buttons reflect queued/running/stopped states from events.

#### AL-174 · Merge panel, confirm and conflict flows
- **Design:** artboard 3 Merge panel, §9 steps 4–5, R9 · **Depends on:** AL-086, AL-087, AL-170
- **Scope:** `features/merge-branches`: "Merge N sub-branches → <ticket branch>" and the dark "Merge worktree → main"; confirm modal (QA-not-passed warning, dirty refusal); conflict view listing files with "Hand to lead agent" / "Open in editor".
- **Acceptance criteria:**
  - [ ] Merge buttons disable with a reason when nothing is ready or the worktree is dirty.

#### AL-175 · Output stream
- **Design:** artboard 3 Output, §12 Performance · **Depends on:** AL-102, AL-170
- **Scope:** Virtualised list (FlashList on react-native-web) of output events: system lines, tool rows (coloured verb chip + mono detail + stats), prose (bold for emphasis), streaming line with caret; auto-follow with "Jump to latest" when scrolled up; text selection (web file if needed, §13).
- **Acceptance criteria:**
  - [ ] 10,000 events keep scrolling at 60 fps; store updates at most once per frame.

#### AL-176 · Composer
- **Design:** artboard 3 footer · **Depends on:** AL-105, AL-106, AL-175
- **Scope:** `features/send-message`: message box ("Message the agent — steer, answer, or add context"), Send, Pause/Resume, skill shortcut chips, "Apply model now"; Ctrl+Enter sends; "Steer now" option sends with `priority: 'now'`.
- **Acceptance criteria:**
  - [ ] Messages sent while paused are queued and delivered on Resume.

#### AL-177 · Sub-agents panel
- **Design:** artboard 3 right column · **Depends on:** AL-107, AL-170
- **Scope:** `entities/sub-agent` (SubAgentNode): Lead agent card (violet, model · effort · role, tokens); children with status pill, description, model · effort, branch or read-only; counts in the header.
- **Acceptance criteria:**
  - [ ] Reviewer queued until Code review shows "Starts at the Code review stage".

#### AL-178 · Sub-branches panel
- **Design:** artboard 3 · **Depends on:** AL-085, AL-177
- **Scope:** List of `sub/…` branches with "N ahead" and Ready, target branch label.
- **Acceptance criteria:**
  - [ ] Refreshes after each merge and sub-agent completion.

#### AL-179 · Diff tab
- **Design:** artboard 3 tabs · **Depends on:** AL-089, AL-170
- **Scope:** File list with stats; unified diff viewer (mono, add/remove tints); compare ticket branch vs base or a sub-branch vs ticket branch.
- **Acceptance criteria:**
  - [ ] Large diffs load per file on demand.

#### AL-180 · ADO tab
- **Design:** artboard 3 tabs, R6 · **Depends on:** AL-066, AL-170
- **Scope:** Work item fields, description and acceptance criteria (sanitised HTML → RN text), comments (including Agent Lanes write-backs), linked PR and checks.
- **Acceptance criteria:**
  - [ ] Never renders raw HTML from ADO.

#### AL-181 · Create PR stage
- **Design:** §7 ADO write-back, §9 alternative to step 5, artboard 6 "PR open" · **Depends on:** AL-064, AL-104, AL-170
- **Scope:** On entering Create PR (after its gate), draft title/description from the agent's summary, let the user edit, create the PR, link the work item, show checks on the card and drill-in; PR completed/abandoned → Done.
- **Acceptance criteria:**
  - [ ] The PR is linked to the work item in ADO.

---

### E11 — Claude Design and design hand-off (R10, R11, artboard 4)

**R11 (hard requirement, 2026-10-07):** the Design section works alongside the agent. It is usable
at every stage, including while Planning and Implementing run. Using it never pauses the agent,
and the agent never blocks it. The user can talk to the design side at any time, and **Approve & ship
design** can be pressed at any time to hand the approved design structure to that ticket's
implementation agent, mid-run if needed.

#### AL-190 · Spike: Claude Design integration surface
- **Design:** §7 Claude Design, §13 risk, Q11, Q12 · **Depends on:** —
- **Scope (time-boxed, 1 day):** Establish (1) whether claude.ai Design loads and signs in inside a `WebContentsView` with its own session partition; (2) what the Claude Design MCP / deep-link surface offers: list artboards, read an artboard's structure/source, read the user's selection, open a canvas by URL, post a message to the canvas's chat; (3) how a canvas is identified per ticket. Output: a short write-up in Decisions and updated scopes for AL-191–AL-197.
- **Acceptance criteria:**
  - [ ] Decision recorded for: embed approach, artboard read path, design-thread path (Q11).

#### AL-191 · Design view service (WebContentsView)
- **Design:** §4 Design view, R10 · **Depends on:** AL-190, AL-011
- **Scope:** Main `DesignViewService`: one `WebContentsView` per open ticket canvas, partition `persist:claude-design`, attached to the main window and positioned over the renderer's canvas placeholder (bounds from a `ResizeObserver` → `design:setBounds`). Switching tabs or pages **hides** the view and never destroys it, so the canvas and its chat keep their state across stage changes (R11). Navigation allow-list (claude.ai and its auth domains); popups go to the OS browser; no preload, no Node, no access to app IPC (AL-011 trusted-sender check). LRU limit on live views (e.g. 3).
- **Acceptance criteria:**
  - [ ] Moving between Output and Claude Design keeps the canvas exactly where it was (scroll, selection, chat draft).
  - [ ] The design view cannot call any app channel (e2e).

#### AL-192 · Design tab page
- **Design:** artboard 4 · **Depends on:** AL-191, AL-140, AL-170
- **Scope:** `pages/design-tab`: compact ticket header (← Board, #id, title, stage pill "Implementing · 46%", model · effort), tab bar, browser-style bar (URL label "claude.ai/design · 71273 JobControl canvas", "Webview · signed in" pill, reload, pop-out to a separate window), canvas area, side panel with Embed mode, Hand off to agent, Attached to this ticket, and the design thread (AL-196). Reachable from the drill-in tab and directly from the board card.
- **Acceptance criteria:**
  - [ ] Matches artboard 4.
  - [ ] Open and usable in every stage, Queued through Done (R11).

#### AL-193 · Link a canvas to a ticket
- **Design:** artboard 4 · **Depends on:** AL-101, AL-192
- **Scope:** Ticket record holds the canvas URL/id; "Link canvas" accepts a pasted claude.ai Design URL (or picks one if AL-190 finds a listing API); "Open in Claude ↗" deep link.
- **Acceptance criteria:**
  - [ ] A linked canvas reopens on the right artboard after an app restart.

#### AL-194 · Embed mode switch and MCP-link fallback
- **Design:** §7, §13 risk, artboard 4 Embed mode · **Depends on:** AL-190, AL-192
- **Scope:** Segmented "Webview — Electron WebContentsView" / "MCP link — Open in Claude, sync via MCP"; persisted per ticket; if sign-in fails in the webview, offer MCP link mode with an explanation; in MCP link mode the canvas opens in Claude and selections sync back.
- **Acceptance criteria:**
  - [ ] Hand-off and the design thread work in both modes.

#### AL-195 · Artboard list and selection
- **Design:** artboard 4 "Hand off to agent" · **Depends on:** AL-190, AL-192
- **Scope:** List the canvas's artboards with names and sizes ("JobControl · desktop 1440×900"), checkboxes, synced with the canvas selection where the surface allows; read each artboard's structure/source for the spec (path chosen in AL-190).
- **Acceptance criteria:**
  - [ ] List refreshes when artboards are added or renamed on the canvas.

#### AL-196 · Design thread at any stage (R11)
- **Design:** R11 · **Depends on:** AL-190, AL-192
- **Scope:** The user can talk to the design side of the ticket at any time, from Queued to Done, while the agent keeps running:
  - **Webview mode:** the canvas's own Claude chat inside the live view is the thread. AL-191 guarantees the view stays alive across stages and tab switches.
  - **MCP-link mode, or when the webview can't sign in:** an in-app Design thread panel (message list + box) backed by a per-ticket **design session** (a separate, lightweight Agent SDK session with the Claude Design MCP tools and the design-system tokens), independent of the lead agent's session (Q11 confirms).
  - Messages in the design thread never go to the implementation agent until shipped (AL-197).
  - Neither side blocks the other: no shared input queue, no shared gate.
- **Acceptance criteria:**
  - [ ] While the lead agent is mid-turn in Implementing, the user can send design messages and get replies, and the agent's output keeps streaming.
  - [ ] The design thread is available in every stage, including during Planning.
  - [ ] Design thread history survives tab switches and app restarts.

#### AL-197 · Approve & ship design at any time (R11)
- **Design:** R11, §7 ("send selected artboards to the agent as a spec"), artboard 4 · **Depends on:** AL-195, AL-198, AL-100
- **Scope:** "Approve & ship N artboards to agent →" is enabled in every stage whenever at least one artboard is selected. It:
  1. Snapshots a **DesignSpec vN**: artboards (name, size, structure/source), design-tokens reference (`agent-lanes-tokens.css` / the project's design system), the user's note, approved by + time, source canvas URL. Stored in the ticket's app-data folder (Decision D8).
  2. Delivers it to the ticket's lead agent **immediately**: an `SDKUserMessage` with `priority: 'now'` (Decision D11), so a running turn picks it up at its next tool boundary and an idle session starts a turn. The message carries a short summary and tells the agent to call `agent_lanes.get_design_spec` (Decision D16).
  3. Works in every stage: in Planning the plan takes the spec into account; in Implementing the agent adjusts course; in Code review / QA it becomes a review criterion.
  4. Never needs a stage gate and never interrupts a gate the user is deciding.
  5. If the session is queued, paused or lost, the spec is held and delivered first when it runs.
- **Acceptance criteria:**
  - [ ] Shipping during Implementing reaches the running agent without a restart, and its next output references the spec version.
  - [ ] Shipping during Planning changes the plan the user is asked to approve.
  - [ ] Shipping twice creates v1 and v2; the agent is told v2 supersedes v1.
  - [ ] Ship is visible in the Output stream ("14:01 · Design v2 approved by Kyle · 2 artboards").

#### AL-198 · Agent-side design tools
- **Design:** R11, artboard 4 ("Agent is watching this canvas", "Used · 14:01") · **Depends on:** AL-103
- **Scope:** Add to the `agent_lanes` MCP server: `get_design_spec({ version? })` → full spec (latest by default); `list_design_specs()`; `ack_design_spec({ version, note })` → marks it "Used" with time and raises `design:spec`. The stage protocol text tells the agent to fetch and acknowledge shipped specs. Sub-agents (e.g. razor-writer) can call `get_design_spec` too.
- **Acceptance criteria:**
  - [ ] "Attached to this ticket" shows "Used · 14:01" after the agent acknowledges.
  - [ ] "Agent is watching this canvas" shows while a spec is fetched but not yet acknowledged.

#### AL-199 · Design specs attached to the ticket
- **Design:** artboard 4 "Attached to this ticket" · **Depends on:** AL-197
- **Scope:** List of shipped specs and attachments (artboards with status Sent / Used / Superseded, the design-system file chip), view a spec, re-ship a previous version, diff two versions' artboard lists.
- **Acceptance criteria:**
  - [ ] List survives restarts and reflects acknowledgements live.

#### AL-200 · Design presence on card and drill-in
- **Depends on:** AL-197, AL-144
- **Scope:** Small "Design v2" indicator on the card when a spec is attached (amber "Design v3 not yet used" while unacknowledged); design events in the live dock and Output stream; "Claude Design ↗" tab badge when the design thread has unread replies.
- **Acceptance criteria:**
  - [ ] The user can see from the board which tickets have an unacknowledged design.

---

### E12 — Resilience and performance

#### AL-210 · Error boundaries
- **Design:** §12 Error handling · **Depends on:** AL-140
- **Scope:** Boundaries around the app root, each page, each lane, the output panel, the sub-agent panel and the design view host; fallback shows what failed and a Retry; errors go to the log (AL-214).
- **Acceptance criteria:**
  - [ ] A thrown error in one card's render leaves the rest of the board working.

#### AL-211 · Error recovery actions
- **Design:** §12 ("Each code has a defined recovery in the UI") · **Depends on:** AL-030, AL-046
- **Scope:** Central map from error code to action: `ADO_UNAUTHORIZED` / `ADO_SCOPE_MISSING` → open Connections on that row; `SESSION_LOST` → Reconnect; `BUILD_FAILED` → open Build log; `MERGE_CONFLICT` → conflict view; `GIT_DIRTY` → Diff tab on uncommitted changes; `VALIDATION` / `INTERNAL` → details + copy diagnostics.
- **Acceptance criteria:**
  - [ ] Every code has a tested action.

#### AL-212 · Performance pass
- **Design:** §12 Performance · **Depends on:** AL-143, AL-175
- **Scope:** Profile the board with 8 streaming tickets and 3 builds; split the renderer bundle (1.09 MB single chunk on 2026-10-07) by page; verify rAF batching, selector isolation, lazy design tab; manual memo only where the profiler shows a hot spot.
- **Acceptance criteria:**
  - [ ] Board stays ≥ 50 fps with 8 streaming tickets; input latency < 100 ms.
  - [ ] Initial renderer chunk < 500 kB.

#### AL-213 · App lifecycle
- **Design:** §10 ("Closing the app stops every run it started") · **Depends on:** AL-100, AL-134
- **Scope:** On quit: stop runs and builds, close sessions gracefully (records flushed, sessions resumable), destroy design views; restore window size/position; warn on quit while agents are mid-turn.
- **Acceptance criteria:**
  - [ ] No orphan `claude`, `dotnet` or `node` processes after quit.

#### AL-214 · Logging and diagnostics
- **Depends on:** AL-040
- **Scope:** Rotating main-process log in app data; redaction of tokens, auth headers and env values; "Copy diagnostics" (versions, settings without secrets, recent errors) from the error fallback.
- **Acceptance criteria:**
  - [ ] A test seeds a PAT and asserts it never appears in the log file.

---

### E13 — Quality and release

#### AL-220 · Feature integration tests
- **Design:** §12 Testing (integration row) · **Depends on:** ongoing
- **Scope:** Vitest + fake bridge + MSW for each feature: create ticket, change model, merge branches, build/run, connections, ship design. Written with each feature ticket; this ticket tracks gaps.
- **Acceptance criteria:**
  - [ ] Every feature slice has an integration test.

#### AL-221 · Main-process test kit
- **Design:** §12 Testing (main process row) · **Depends on:** AL-080, AL-100
- **Scope:** Temp git repo factory (with origin remote); fake Agent SDK `query()` that replays scripted `SDKMessage` streams and records input/control calls (`setModel`, `applyFlagSettings`, `interrupt`, pushed user messages with priority); fake `safeStorage`.
- **Acceptance criteria:**
  - [ ] Session manager, worktree/merge service, build queue and secret store have tests on this kit.

#### AL-222 · E2E golden path
- **Design:** §12 Testing (e2e row) · **Depends on:** AL-221, AL-047, AL-165, AL-171, AL-174
- **Scope:** Playwright: first run → connect (MSW-backed ADO, fake Claude) → pick temp repo → create ticket → approve plan → ship a design during Implementing (R11) → merge. Main swaps in fakes behind a test-only env flag that production builds strip.
- **Acceptance criteria:**
  - [ ] Runs in CI in under 5 minutes.

#### AL-223 · Visual QA against the artboards
- **Depends on:** E8–E11
- **Scope:** Capture each screen and state at 1440 × 960 and compare side by side with `docs/design/screens/*`; log differences as tickets or Decisions.
- **Acceptance criteria:**
  - [ ] All seven artboards reviewed and signed off.

#### AL-224 · Release build and signing
- **Depends on:** AL-007 · **Blocked by:** Q7
- **Scope:** Code-signing certificate in CI secrets, signed installer, version bump script, release notes.
- **Acceptance criteria:**
  - [ ] SmartScreen shows the publisher name on install.

#### AL-225 · User guide
- **Depends on:** AL-047
- **Scope:** `README.md`: what it is, install, first run, PAT scopes, Claude login vs API key, MCP servers, troubleshooting.
- **Acceptance criteria:**
  - [ ] A teammate installs and launches a first agent using only the guide.

#### AL-226 · Register in the ai-tools index
- **Blocked by:** Q8
- **Scope:** Per the company check-before-building process: shared applications live in `tools/<name>/` in the `ai-tools` repo (Tools project) with an owner line and an index row. Decide with the owner of `ticket-tracker` (Kyle) whether Agent Lanes replaces it.
- **Acceptance criteria:**
  - [ ] Index row added, or a recorded decision to keep it separate.

---

## 4. Decisions

| # | Decision | Why | Date |
|---|---|---|---|
| D1 | Vite 7.3 with electron-vite 5, not Vite 8 | electron-vite 5.0.0 peers `vite ^5–^7` | 2026-10-07 |
| D2 | TypeScript 6.0.x, not 7 | typescript-eslint 8.71 supports TS < 6.1 | 2026-10-07 |
| D3 | pnpm 10.34 with `node-linker=hoisted`; `onlyBuiltDependencies` for electron and esbuild | electron-builder expects a flat node_modules; pnpm 10 blocks install scripts by default | 2026-10-07 |
| D4 | UI unit tests use `@testing-library/react` rendering RN components through react-native-web in jsdom, instead of React Native Testing Library | The app ships react-native-web; RNTL needs the native renderer and RN's Flow sources, which Vitest can't run without a Metro/Babel preset. Tests see the same DOM users get. Revisit if a native build is added (Q3) | 2026-10-07 |
| D5 | Layer and process boundaries via ESLint `no-restricted-imports`; Steiger for FSD semantics; `eslint-plugin-boundaries` not used | boundaries v7's new policy API was unproven here; the built-in rule was verified with probe files | 2026-10-07 |
| D6 | Error codes add `VALIDATION` and `INTERNAL` to the design's six | Contract violations and unexpected throws still need a typed code | 2026-10-07 |
| D7 | IPC = `ipcMain.handle` + sender-frame check; preload exposes only `invoke`/`on` from an allow-list; both ends validate with zod | Keeps the Claude Design view and any navigated frame away from app channels | 2026-10-07 |
| D8 | Ticket state lives in app-written JSON under `<userData>/tickets/…`, not in the worktree | Files in the worktree would make it dirty (breaks GIT_DIRTY) and leak into commits; app-written JSON keeps R2/R5 (no DB, nothing user-edited) | 2026-10-07 |
| D9 | The app creates sub-agent worktrees through the SDK `WorktreeCreate` hook (`sub/<ticket>-<name>` off the ticket branch); `WorktreeRemove` defers to Archive | Gives the design's branch naming and keeps §9's "never delete automatically" | 2026-10-07 |
| D10 | Live model change via `Query.setModel()`, effort via `Query.applyFlagSettings({ effortLevel })`. Model map: Opus → `claude-opus-5-5`, Sonnet → `claude-sonnet-5-5`, Haiku → `claude-haiku-4-5` (one constant in contracts). Effort Low/Med/High/XHigh/Max → `low`/`medium`/`high`/`xhigh`/`max` | SDK 0.3.292 types; current model IDs as of 2026-10-07 | 2026-10-07 |
| D11 | Mid-run delivery uses `SDKUserMessage.priority`: `'now'` (design ship, "steer now") interjects at the next tool boundary; `'next'` (normal messages) waits for the turn. Build results use `shouldQuery: false` so they ride along with the next turn | Meets R11 and §10 without restarting sessions | 2026-10-07 |
| D12 | Sessions in a worktree pass `projectConfigRoot` = the repo's main checkout | Project skills, settings and `.mcp.json` come from the trusted checkout, not whatever the branch carries | 2026-10-07 |
| D13 | Small typed in-app router (three routes) instead of React Navigation | Three routes, desktop only; avoids a navigation stack built for mobile. Revisit with Q3 | proposed |
| D14 | The web entry imports `AppRegistry` from react-native-web, typed by a local `.d.ts` | RN's types model native `RootTag`; `@types/react-native-web` exports interfaces only | 2026-10-07 |
| D15 | App ID `au.com.companionsystems.agentlanes`; NSIS per-user installer; Windows x64 first | Team platform | 2026-10-07 |
| D16 | Design hand-off sends a short user turn and the agent pulls the full spec with `agent_lanes.get_design_spec`, then calls `ack_design_spec` | Keeps large artboard payloads out of the prompt and gives the UI an acknowledgement for "Used · 14:01" | 2026-10-07 |
| D17 | CI runs on GitHub Actions (answers Q6) | The repo now lives at github.com/KyleRichards94/ClaudeLanes | 2026-10-07 |
| D18 | Headless permission policy for the first build: `acceptEdits`, plus a Bash allow-list of git read commands and the repo's detected build and test commands; anything else asks through `canUseTool` ("Needs you · permission"). Editable in settings (provisional answer to Q9) | Lets AL-109 proceed; the user can tighten or loosen it later | 2026-10-07 |
| D19 | IPC channels and main-process handlers are split per domain (`contracts/src/domains/*`, `src/main/<domain>/handlers.ts`, composition root `src/main/services.ts`) | ~110 parallel branches would otherwise collide on two files | 2026-10-07 |

---

## 5. Open questions

| # | Question | Blocks | Proposed default |
|---|---|---|---|
| Q1 | Does "Merge worktree → main" merge locally and push, or always go through an ADO PR? (design) | AL-087 | Local merge + push, with the "block until PR approved" setting available |
| Q2 | Which branch is "version main" for OnSite Companion: `main` or a release branch per version? (design) | AL-081, AL-087 | Per-repo base branch setting |
| Q3 | Native mobile companion in scope, or desktop only? (design) | D4, D13 | Desktop only |
| Q4 | Claude credentials: API key per user, or each developer's Claude Code login? (design) | AL-044 | Support both; prefer the existing login |
| Q5 | Maximum concurrent agents per machine for the team's hardware (design) | AL-111 | 3 per repo, adjustable |
| Q6 | ~~CI host~~ Answered: GitHub Actions (D17) | — | — |
| Q7 | Code-signing certificate for the Windows installer: which, and who holds it? | AL-224 | — |
| Q8 | Company process puts shared apps in `ai-tools/tools/<name>/`; Kyle's unmigrated `ticket-tracker` covers similar ground. Keep this repo standalone, or move it there and retire `ticket-tracker`? | AL-226 | Decide before the first teammate install |
| Q9 | What may a headless agent run without asking? | — (built with the default, D18) | `acceptEdits` + git read, build and test commands; everything else asks |
| Q10 | ADO doesn't tell a PAT its own expiry. Ask for the expiry date when saving (optional), or don't show it? | AL-043 | Optional expiry field; warn 7 days before |
| Q11 | R11 "talk to the design section": Claude Design's own chat in the embedded canvas, an in-app design thread backed by a per-ticket design agent, or both? | AL-196 | Both: canvas chat in webview mode, in-app design thread in MCP-link mode |
| Q12 | What can Claude Design expose programmatically (artboard list, source, selection, chat)? | AL-190–AL-197 | Answered by spike AL-190 |

---

## 6. Change log

| Date | Change |
|---|---|
| 2026-10-07 | Plan created from the design doc (rev 14) and its seven artboards. Added R11 (Kyle, hard requirement): design section usable at any stage, approve & ship design to the implementation agent at any time → epic E11 rewritten around it (AL-191, AL-196–AL-200). |
| 2026-10-07 | Environment prepared: pnpm/Turborepo monorepo, electron-vite 5 + Electron 44, React 19 + react-native-web 0.21 + React Compiler, typed IPC with zod, tokens package, GlassPanel, ESLint + Steiger, Vitest (45 tests), Playwright smoke e2e (3 tests, isolated profile). Done: AL-001–AL-006, AL-009–AL-011, AL-013, AL-014, AL-020, AL-022. AL-007 in progress (config only). |
| 2026-10-07 | Repo pushed to github.com/KyleRichards94/ClaudeLanes. Prepared for the parallel build: IPC contracts and main handlers split per domain (D19), composition root `src/main/services.ts`, quit waits for `disposeServices`. Q6 answered (GitHub Actions, D17); Q9 built with the default (D18); AL-008 and AL-109 unblocked. Rules in §7. |

---

## 7. Parallel build rules

One sub-agent builds each ticket. An agent starts as soon as every ticket it depends on is merged
into `main`. Up to 8 build at once (this machine's RAM and disk), plus one integrator that merges.

**Ticket agent**

1. Branch and worktree off `main`:
   `git worktree add -b feature/AL-xxx-<slug> C:/Users/Kyle.Richards/al/AL-xxx main`. Work only there.
2. Setup: `pnpm install`. For e2e, reuse the main checkout's Electron binary instead of downloading
   another: copy `node_modules/electron/path.txt` from the main checkout and set
   `ELECTRON_OVERRIDE_DIST_PATH=<main checkout>/node_modules/electron/dist`.
3. Build only this ticket. Reuse code already merged; if something from another ticket is missing,
   build the smallest piece needed and report it.
4. Shared registration points get lines added, never rewritten: `packages/contracts/src/domains/*`,
   `apps/desktop/src/main/services.ts`, `apps/desktop/src/main/ipc/handlers.ts` (one line per
   domain), `packages/ui/src/index.ts`, `apps/desktop/src/renderer/app/**` wiring.
5. Don't edit `docs/TICKETS.md` or `docs/design/*`. Decisions, unmet criteria and follow-ups go in
   the agent's result; the integrator records them.
6. No real credentials and no calls to real Azure DevOps, claude.ai or the Claude API: fakes and MSW.
7. Before committing: `pnpm typecheck`, `pnpm lint` and `pnpm test` green, plus `pnpm e2e` when
   `apps/desktop` changed.
8. Commit as `AL-xxx: <summary>` with the Co-Authored-By trailer, then push the branch.

**Integrator** (one at a time, in the main checkout)

1. Merge finished branches into `main` with `git merge --no-ff`, in the order they finished.
2. Conflicts: registration files keep both sides; `pnpm-lock.yaml` takes `main`'s version, then
   `pnpm install` after the merges and the regenerated lockfile is committed.
3. `pnpm verify` and `pnpm e2e` on `main`. Small integration breaks are fixed on `main`
   (`Integrate AL-xxx: …`). A merge that can't be made green is reverted and the ticket goes back to
   its agent with the reason (one retry).
4. Update §2 status (`done` or `partial`), tick met criteria in the ticket body, add reported
   decisions to §4 and a Change log line, commit, `git push origin main`.
5. Remove merged worktrees. Branches stay on GitHub.

**Ordering:** dependencies from §2, plus three rules. Every ticket with UI (AL-046, AL-047, AL-135,
AL-142–AL-146, AL-160–AL-165, AL-170–AL-181, AL-192–AL-197, AL-199, AL-200, AL-210, AL-211) also
waits for the primitives AL-023–AL-031, so screens don't grow their own buttons and pills. AL-220
runs last. AL-223 waits for all of E8–E11. AL-224 and AL-226 wait for Kyle (Q7, Q8).
