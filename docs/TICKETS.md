done |done |# Agent Lanes — Build Plan and Tickets

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
| **M0 Foundation** | The app opens, renders RN-web with tokens and glass, and talks to the main process over typed IPC | E0, AL-010–AL-015, AL-020, AL-022 | `pnpm verify` + `pnpm e2e` green (met 2026-10-07, except AL-007) |
| **M1 Walking skeleton** | Connect ADO and Claude, pick a repo, launch one agent on a real work item, and watch its card move through the lanes with live output | AL-012, AL-015, AL-021, AL-023–AL-031, AL-040–AL-047, AL-060–AL-066, AL-080–AL-083, AL-100–AL-103, AL-105, AL-140–AL-145, AL-160–AL-165, AL-170, AL-175 | Manual run against a real ADO sprint + repo: ticket reaches Implementing with streamed output |
| **M2 Control** | Gates, model/effort switching, messaging, sub-agents, crash recovery, queueing | AL-104, AL-106–AL-111, AL-113–AL-115, AL-171, AL-172, AL-176, AL-177 | Approve a plan; switch Opus→Sonnet mid-run; kill the session process and see it resume |
| **M3 Ship** | Build/run per worktree, both merges, diff, ADO tab, PR stage, archive | E7, AL-084–AL-090, AL-112, AL-173, AL-174, AL-178–AL-181 | Two tickets build and run side by side; sub-branches merge; a PR is created with checks on the card |
| **M4 Design (R10, R11)** | Claude Design beside the ticket; talk to the design at any stage; approve & ship the design to the running agent at any time | E11 | Ship a design while the agent is Implementing; the agent acknowledges and uses it without a restart |
| **M6 Team board (add-on)** | The team's ADO board under the lanes; drag a card or PR onto a lane to start the right agent, with a 10 s Undo; Backlog popout | E14 (AL-230–AL-241) | Drop a Failed item on Planning: assigned, In Progress, agent planning; Undo restores ADO |
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
| AL-007 | Packaging (electron-builder, NSIS) | E0 | M | AL-002 | partial |
| AL-008 | CI pipeline | E0 | S | AL-004, AL-005, AL-006 | done |
| AL-009 | Agent docs: CLAUDE.md, design copy, this plan | E0 | S | — | done |
| AL-010 | Result type and error codes | E1 | S | AL-001 | done |
| AL-011 | Invoke channels: contracts, router, validation, trusted sender | E1 | S | AL-010 | done |
| AL-012 | Event channels: main → renderer push | E1 | S | AL-011 | done |
| AL-013 | Preload bridge | E1 | S | AL-011 | done |
| AL-014 | Renderer IPC client | E1 | S | AL-013 | done |
| AL-015 | Event hub in the app layer | E1 | S | AL-012 | done |
| AL-020 | Tokens package (TS + CSS) | E2 | S | AL-001 | done |
| AL-021 | Bundled fonts | E2 | S | AL-020 | partial |
| AL-022 | GlassPanel | E2 | S | AL-020 | done |
| AL-023 | Text primitives | E2 | S | AL-021 | done |
| AL-024 | Button | E2 | S | AL-023 | done |
| AL-025 | Pill, Badge, StatusBadge, IdChip | E2 | S | AL-023 | done |
| AL-026 | SegmentedControl and Switch | E2 | S | AL-023 | done |
| AL-027 | TextField | E2 | S | AL-023 | done |
| AL-028 | Card and ProgressBar | E2 | S | AL-022 | done |
| AL-029 | Modal and Tabs | E2 | M | AL-022, AL-024 | done |
| AL-030 | Toast and ToastHost | E2 | S | AL-024 | done |
| AL-031 | Icons | E2 | S | AL-020 | done |
| AL-032 | Component gallery (dev route) | E2 | S | AL-023–AL-031 | done |
| AL-033 | Accessibility checks | E2 | S | AL-032 | done |
| AL-040 | Secret store (safeStorage) | E3 | M | AL-011 | partial |
| AL-041 | Settings store and UI prefs | E3 | M | AL-011 | done |
| AL-042 | Connections service and IPC | E3 | M | AL-040, AL-041 | done |
| AL-043 | ADO connection test | E3 | M | AL-042, AL-060 | partial |
| AL-044 | Claude connection | E3 | M | AL-042 | partial |
| AL-045 | MCP server entries | E3 | M | AL-042 | partial |
| AL-046 | Connections modal UI | E3 | L | AL-043, AL-044, AL-045, AL-027, AL-029 | done |
| AL-047 | First-run flow and repo picker | E3 | M | AL-046, AL-081 | done |
| AL-048 | Credential failure handling | E3 | M | AL-046, AL-100, AL-030 | done |
| AL-060 | ado-client core | E4 | M | AL-001 | done |
| AL-061 | Sprints (iterations) | E4 | S | AL-060 | done |
| AL-062 | Work items: sprint list, search, get | E4 | M | AL-060 | done |
| AL-063 | Work item write-back (comments, state) | E4 | S | AL-060 | partial |
| AL-064 | Pull requests: create, link, checks | E4 | M | AL-060 | partial |
| AL-065 | Main ADO service, IPC and MSW fixtures | E4 | M | AL-061–AL-064, AL-042 | done |
| AL-066 | Renderer ADO queries and refetch policy | E4 | S | AL-065 | done |
| AL-080 | Git runner | E5 | S | AL-001 | done |
| AL-081 | Repo registry and folder picker | E5 | M | AL-080, AL-041 | done |
| AL-082 | Branch and worktree naming | E5 | S | — | done |
| AL-083 | Create the ticket worktree | E5 | M | AL-081, AL-082 | done |
| AL-084 | Sub-agent worktrees (WorktreeCreate hook) | E5 | M | AL-083, AL-100 | partial |
| AL-085 | Branch status | E5 | S | AL-083 | done |
| AL-086 | Merge sub-branches → ticket branch | E5 | M | AL-084, AL-085 | done |
| AL-087 | Merge worktree → main | E5 | M | AL-085 | partial |
| AL-088 | Archive | E5 | M | AL-083 | done |
| AL-089 | Diff provider | E5 | S | AL-083 | done |
| AL-090 | Start-up reconciliation | E5 | M | AL-083, AL-101 | partial |
| AL-100 | Session manager core | E6 | L | AL-083, AL-044 | partial |
| AL-101 | Ticket records | E6 | M | AL-041 | done |
| AL-102 | Output normalisation and transcript buffer | E6 | L | AL-100, AL-012 | partial |
| AL-103 | Stage protocol: `agent_lanes` MCP server | E6 | M | AL-100 | partial |
| AL-104 | Stage gates | E6 | M | AL-103 | partial |
| AL-105 | Messages, skills and pause | E6 | S | AL-100 | partial |
| AL-106 | Live model and effort change | E6 | M | AL-100 | done |
| AL-107 | Sub-agent tracking | E6 | M | AL-102 | done |
| AL-108 | MCP injection and status | E6 | M | AL-100, AL-045 | partial |
| AL-109 | Permission policy for headless sessions | E6 | M | AL-100 | partial |
| AL-110 | Crash recovery | E6 | M | AL-100, AL-101 | partial |
| AL-111 | Concurrency cap and Queued lane | E6 | S | AL-100 | done |
| AL-112 | Build result as next-turn context | E6 | S | AL-100, AL-132 | partial |
| AL-113 | Usage, tokens and session pill | E6 | S | AL-102 | done |
| AL-114 | Skill discovery | E6 | S | AL-100 | partial |
| AL-115 | ADO write-back on stage change | E6 | S | AL-103, AL-063 | done |
| AL-130 | Build/run command detection and overrides | E7 | S | AL-081 | done |
| AL-131 | Job queue | E7 | S | AL-011 | done |
| AL-132 | Build job and log parsing | E7 | M | AL-130, AL-131, AL-012 | partial |
| AL-133 | Run job, port and URL | E7 | M | AL-132 | done |
| AL-134 | Stop and process-tree kill | E7 | S | AL-133 | done |
| AL-135 | Build log tab | E7 | M | AL-132, AL-029 | done |
| AL-140 | App router and lazy pages | E8 | S | AL-003 | done |
| AL-141 | Agent ticket entity and store | E8 | M | AL-015, AL-101 | done |
| AL-142 | Board header | E8 | M | AL-141, AL-066, AL-024, AL-025, AL-081 | done |
| AL-143 | Lanes | E8 | M | AL-141 | partial |
| AL-144 | AgentTicketCard and its states | E8 | M | AL-141, AL-025, AL-028 | partial |
| AL-145 | Live dock | E8 | S | AL-141 | done |
| AL-146 | Settings panel (repo and defaults) | E8 | M | AL-041, AL-130, AL-029 | partial |
| AL-160 | New-ticket modal shell and form state | E9 | M | AL-029 | done |
| AL-161 | Work item picker | E9 | M | AL-160, AL-066 | done |
| AL-162 | Job description and skill chips | E9 | S | AL-160, AL-114 | done |
| AL-163 | Model and effort pickers | E9 | S | AL-160, AL-026 | done |
| AL-164 | Workspace preview and stage gates | E9 | S | AL-160, AL-082 | done |
| AL-165 | Launch | E9 | M | AL-161–AL-164, AL-083, AL-100, AL-111 | done |
| AL-170 | Ticket page frame | E10 | M | AL-140, AL-141 | done |
| AL-171 | Stage stepper and gate actions | E10 | M | AL-104, AL-170 | done |
| AL-172 | Agent panel (model and effort) | E10 | S | AL-106, AL-170 | done |
| AL-173 | Worktree panel (Build, Run, Stop) | E10 | S | AL-134, AL-170 | done |
| AL-174 | Merge panel, confirm and conflict flows | E10 | M | AL-086, AL-087, AL-170 | done |
| AL-175 | Output stream | E10 | L | AL-102, AL-170 | done |
| AL-176 | Composer | E10 | S | AL-105, AL-106, AL-175 | done |
| AL-177 | Sub-agents panel | E10 | M | AL-107, AL-170 | done |
| AL-178 | Sub-branches panel | E10 | S | AL-085, AL-177 | done |
| AL-179 | Diff tab | E10 | M | AL-089, AL-170 | done |
| AL-180 | ADO tab | E10 | M | AL-066, AL-170 | done |
| AL-181 | Create PR stage | E10 | M | AL-064, AL-104, AL-170 | partial |
| AL-190 | Spike: Claude Design integration surface | E11 | S | — | partial |
| AL-191 | Design view service (WebContentsView) | E11 | L | AL-190, AL-011 | done |
| AL-192 | Design tab page | E11 | M | AL-191, AL-140, AL-170 | partial |
| AL-193 | Link a canvas to a ticket | E11 | S | AL-101, AL-192 | done |
| AL-194 | Embed mode switch and MCP-link fallback | E11 | M | AL-190, AL-192 | partial |
| AL-195 | Artboard list and selection | E11 | M | AL-190, AL-192 | partial |
| AL-196 | Design thread at any stage (R11) | E11 | L | AL-190, AL-192 | done |
| AL-197 | Approve & ship design at any time (R11) | E11 | L | AL-195, AL-198, AL-100 | partial |
| AL-198 | Agent-side design tools | E11 | M | AL-103 | done |
| AL-199 | Design specs attached to the ticket | E11 | S | AL-197 | done |
| AL-200 | Design presence on card and drill-in | E11 | S | AL-197, AL-144 | done |
| AL-210 | Error boundaries | E12 | S | AL-140 | partial |
| AL-211 | Error recovery actions | E12 | M | AL-030, AL-046 | done |
| AL-212 | Performance pass | E12 | M | AL-143, AL-175 | partial |
| AL-213 | App lifecycle | E12 | S | AL-100, AL-134 | done |
| AL-214 | Logging and diagnostics | E12 | S | AL-040 | done |
| AL-230 | Drop rules (`allowedLanes`) | E14 | S | AL-141 | done |
| AL-231 | ADO team board data (`ado:teamBoard`) | E14 | M | AL-065, AL-061 | done |
| AL-232 | Active PRs with thread counts (`ado:activePrs`) | E14 | M | AL-064, AL-065 | done |
| AL-233 | Backlog data (`ado:backlog`) | E14 | M | AL-065 | done |
| AL-234 | Team board widget | E14 | L | AL-230, AL-231, AL-232, AL-066, AL-143 | partial |
| AL-235 | Drag to lane (dnd-kit + keyboard) | E14 | L | AL-230, AL-234 | done |
| AL-236 | Launch from ADO transaction (`agent:launchFromAdo`) | E14 | L | AL-230, AL-100, AL-083, AL-063, AL-111, AL-165 | done |
| AL-237 | Undo a launch (`agent:undoLaunch`) | E14 | M | AL-236, AL-030 | done |
| AL-238 | PR launches: review and answer comments | E14 | M | AL-236, AL-232 | done |
| AL-239 | Backlog popout | E14 | L | AL-233, AL-235, AL-236, AL-029 | partial |
| AL-240 | Per-lane drop defaults and Alt launch sheet | E14 | M | AL-146, AL-236 | done |
| AL-241 | E2E: team board drops | E14 | M | AL-237, AL-238, AL-239, AL-240 | partial |
| AL-242 | Board picker for the team board | E14 | M | AL-234 | todo |
| AL-220 | Feature integration tests | E13 | M | ongoing | done |
| AL-221 | Main-process test kit | E13 | M | AL-080, AL-100 | done |
| AL-222 | E2E golden path | E13 | L | AL-221, AL-047, AL-165, AL-171, AL-174 | partial |
| AL-223 | Visual QA against the artboards | E13 | M | E8–E11, AL-234, AL-239 | partial |
| AL-224 | Release build and signing | E13 | M | AL-007 | blocked (Q7) |
| AL-225 | User guide | E13 | S | AL-047 | partial |
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
  - [ ] `pnpm package` produces `release/<version>/Agent Lanes-<version>-setup.exe`. (open: not run, drive C: was full and packaging stopped with ENOSPC; config, icon and pinned Electron are in, `e2e/packaged/packaged-app.spec.ts` checks the file. Run `pnpm e2e:packaged` once there is ~1.2 GB free)
  - [ ] Installed app launches, shows the board, and can start an Agent SDK session (after AL-100). (open: not run, disk full; `resolveClaudeExecutable` finds the SDK binary in dev and the packaged spec runs it with `--version` from app.asar.unpacked; starting a session needs AL-100)
  - [ ] Uninstall leaves no files outside the app data folder. (open: not run, disk full; `build/installer.nsh` removes the leftover installer copy, `install.spec.ts` checks it with `AGENT_LANES_INSTALL_TEST=1`; manual install on a clean Windows VM still to do)
- **Tests:** manual install on a clean Windows VM; record result in Change log.

#### AL-008 · CI pipeline
- **Design:** §5 · **Depends on:** AL-004, AL-005, AL-006 · **Host:** GitHub Actions (Decision D17)
- **Scope:** `.github/workflows/ci.yml` running `pnpm install --frozen-lockfile`, `pnpm verify`, and `pnpm e2e` on a Windows agent (Electron needs a desktop session; use `xvfb-run` if a Linux agent is used). Cache the pnpm store and the Electron download.
- **Acceptance criteria:**
  - [x] Every PR runs typecheck, lint, Steiger, unit tests, build and e2e.
  - [x] Failing Steiger or a layer-rule violation fails the build.

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
  - [x] `emit` with an invalid payload throws in dev and logs + drops in production.
  - [x] Events are delivered only to the trusted renderer frame.
  - [x] Preload `on()` returns an unsubscribe function; unsubscribing stops delivery.
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
  - [x] Exactly one bridge subscription per channel for the app's lifetime.
  - [x] 1,000 `agent:output` events within one frame cause one store commit.
  - [x] An invalid payload is dropped and logged, and doesn't break the stream.
- **Tests:** unit test with fake bridge + fake rAF. (done: 10 tests in `app/entrypoint/EventHub.test.ts`)

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
  - [x] Board title renders in Plus Jakarta Sans 800 and ids/branches in JetBrains Mono with the network disabled.
  - [ ] Font licences (OFL) included in the packaged app's licence notices. (open: licence files committed in `apps/desktop/licenses/fonts/` and shipped via electron-builder `extraFiles`, e2e checks the files and config; not yet confirmed in a real package. Check `<install dir>/licenses/fonts/*.txt` once AL-007 packages)

#### AL-022 · GlassPanel
- **Design:** §11 Glass, artboard 7 · **Depends on:** AL-020
- **Scope:** Levels `sm` 8 px, `md` 18 px, `xl` 40 px; white 62–72 % fill; inset top highlight; panel/modal radius.
- **Acceptance criteria:**
  - [x] Blur and fill match the tokens; renders in Electron (smoke screenshot).

#### AL-023 · Text primitives
- **Design:** §11 Type · **Depends on:** AL-021
- **Scope:** `Text` variants `display` (800), `title` (700, card titles, panel headings), `body` (500), `meta` (muted), `mono` (ids, branches, logs, diffs); `selectable` prop (logs need text selection — web file if RN-web's default is not enough, §13 risk).
- **Acceptance criteria:**
  - [x] All text in the app goes through these variants (lint rule or review). (ESLint `no-restricted-syntax` rule, 3 lint probes)
  - [x] Body text on `bg` and `surface` meets 4.5:1. (contrast test covers all five variants on bg, surface and the card-section washes)

#### AL-024 · Button
- **Design:** §11 Primitives, artboard 7 · **Depends on:** AL-023
- **Scope:** Variants `primary` (Claude violet), `strong` (ink), `secondary` (white + line), `soft` (Claude tint pill); sizes; optional leading icon; `loading` and `disabled`; hover lifts 3 px with the deeper shadow over 150–220 ms ease-out; pressed state; focus ring; min 44 px target.
- **Acceptance criteria:**
  - [x] All four variants match artboard 7.
  - [x] Keyboard: Tab focuses with the violet ring; Enter/Space activates.
  - [x] `disabled` blocks presses and is announced (`aria-disabled`).

#### AL-025 · Pill, Badge, StatusBadge, IdChip
- **Design:** artboards 1, 6 · **Depends on:** AL-023
- **Scope:** `Pill` (tone: claude, ado, ok, attention, danger, neutral; optional dot); `Badge` (lane counts, amber variant); `StatusBadge` with fixed words — Running, Done, Queued, Needs you, Switching · next turn; `IdChip` (mono `#71273` on ADO tint).
- **Acceptance criteria:**
  - [x] Every status pill carries a word, not only a colour.
  - [x] Matches the "Status badges" block on artboard 6.

#### AL-026 · SegmentedControl and Switch
- **Design:** artboards 2, 3 · **Depends on:** AL-023
- **Scope:** `SegmentedControl` (Sprint/Search/No ticket; Low/Med/High/XHigh/Max; Output/Diff/…) with arrow-key navigation and `radiogroup` semantics; `Switch` with label and "Auto / Needs approval" side text.
- **Acceptance criteria:**
  - [x] Arrow keys move selection; selected segment is white with the violet text where the artboard shows it.
  - [x] Switch toggles with Space and exposes `role="switch"` + `aria-checked`.

#### AL-027 · TextField
- **Design:** artboards 2, 5 · **Depends on:** AL-023
- **Scope:** Single-line, multiline (job description), `secure` (PAT/API key: masked, no autocomplete, no spellcheck, never echoed into logs or state outside the form), search variant with leading icon; label, help text, error text.
- **Acceptance criteria:**
  - [x] Secure fields clear their value from component state after submit.
  - [x] Error text is linked with `aria-describedby`.

#### AL-028 · Card and ProgressBar
- **Design:** artboards 1, 6 · **Depends on:** AL-022
- **Scope:** `Card` (surface, radius 16, card shadow, optional border tone: selected violet, attention amber, danger red, muted for merged; optional footer band in attention/ado/danger/ok tint); `ProgressBar` (violet→sky gradient, green for merged).
- **Acceptance criteria:**
  - [x] Card supports every border + footer combination on artboard 6.

#### AL-029 · Modal and Tabs
- **Design:** artboards 2, 3, 5 · **Depends on:** AL-022, AL-024
- **Scope:** `Modal` (glass xl, radius 28, header icon + title + subtitle, close button, footer slot; focus trap; Esc closes unless `blocking`; restores focus on close; backdrop blur); `Tabs` (pill tab bar as on the drill-in, optional trailing ↗ icon, status dot per tab as on Connections).
- **Acceptance criteria:**
  - [x] Focus stays inside an open modal; Esc closes non-blocking modals only.
  - [x] A `blocking` modal (first-run Connections) cannot be dismissed.

#### AL-030 · Toast and ToastHost
- **Design:** artboard 6 "Toast · error" · **Depends on:** AL-024
- **Scope:** `ToastHost` in `app/`; `toast({ tone, title, body, actions })`; error toast with icon, primary action (e.g. Reconnect) and Dismiss; stacking; auto-dismiss for info only; `aria-live`.
- **Acceptance criteria:**
  - [x] Error toasts stay until acted on; info toasts auto-dismiss after 5 s.
  - [x] Toasts can be raised from the main process through the `toast` event (AL-012).

#### AL-031 · Icons
- **Depends on:** AL-020
- **Scope:** One `Icon` primitive (lucide set via `react-native-svg`, which renders on web) for: plus, link, chevron, arrow-left, arrow-right, play, stop, hammer/build, branch/merge, external-link, refresh, search, check, close, lock, alert, pause.
- **Acceptance criteria:**
  - [x] Icons inherit text colour and size; decorative icons are hidden from screen readers.

#### AL-032 · Component gallery (dev route)
- **Design:** artboards 6, 7 · **Depends on:** AL-023–AL-031
- **Scope:** A development-only page that renders the tokens sheet and every card state, for side-by-side checking against `docs/design/screens/06-card-states.png` and `07-design-tokens.png`. Excluded from production builds.
- **Acceptance criteria:**
  - [x] Reachable in `pnpm dev` only.
  - [x] Covers every primitive and every card state.

#### AL-033 · Accessibility checks
- **Design:** §11 Accessibility · **Depends on:** AL-032
- **Scope:** Unit test computing contrast for each text/background token pair in use (≥ 4.5:1 body, ≥ 3:1 large/UI); axe check of the gallery page in e2e; target-size audit.
- **Acceptance criteria:**
  - [x] Contrast test passes for all used pairs (record any pair adjusted in Decisions).
  - [x] No serious axe violations on the gallery, board and modals.

---

### E3 — Secrets, settings and Connections

#### AL-040 · Secret store (safeStorage)
- **Design:** §8 Storage · **Depends on:** AL-011
- **Scope:** Main-only `SecretStore`: `put(id, secret)`, `get(id)`, `delete(id)`, `list()` (ids + metadata only). Encrypted with `safeStorage.encryptString` (DPAPI / Keychain / libsecret) into `<userData>/secrets.json`; refuse to store if `safeStorage.isEncryptionAvailable()` is false (no plaintext fallback). Only other main services can read; no IPC channel returns a secret.
- **Acceptance criteria:**
  - [x] File on disk contains no plaintext token (test greps the file).
  - [x] No contract schema contains a secret field in any response (contract test).
  - [ ] Corrupt file → secrets treated as missing, user prompted to reconnect, nothing crashes. (open: missing-secret handling and no-crash are done and e2e-tested; the reconnect prompt needs AL-042/AL-047 to read `secrets.status().issues` and raise a Reconnect toast)
- **Tests:** main unit tests with a fake `safeStorage`.

#### AL-041 · Settings store and UI prefs
- **Design:** §6 Persisted UI prefs, §8, R5 · **Depends on:** AL-011
- **Scope:** electron-store (app data, written only by the app) with a versioned zod schema + migrations: repos (path, name, base branch, worktree root, build/run overrides, max concurrent agents), defaults (model, effort, stage gates, skills), build queue size, UI prefs (last repo, last sprint, collapsed lanes, embed mode per ticket). IPC `settings:get`, `settings:update` (partial, validated). Renderer Zustand `persist` adapter backed by these channels for UI prefs.
- **Acceptance criteria:**
  - [x] Nothing in the app reads a user-edited file; settings change only through the UI.
  - [x] Schema migration from v1 to v2 is covered by a test.
  - [x] Collapsed lanes survive a restart. (store-level and e2e relaunch test; the click-to-collapse UI test comes with AL-143)

#### AL-042 · Connections service and IPC
- **Design:** §8 · **Depends on:** AL-040, AL-041
- **Scope:** Main `ConnectionsService` holding ADO orgs (url, default project, identity, PAT ref), Claude (mode: existing login | API key), MCP servers. Channels: `connections:list` (name, kind, identity, expiry, status ok/error/untested, missing scopes), `connections:test` (draft or saved), `connections:save`, `connections:replace`, `connections:remove`. Event `connections:changed`. PATs go straight from the save request into SecretStore; the response carries a masked tail only (`••••••••7Fq2`).
- **Acceptance criteria:**
  - [x] No response or event contains a full token (contract test + e2e IPC spy).
  - [x] Remove deletes the secret and any session env that used it on next launch.

#### AL-043 · ADO connection test
- **Design:** §8 ("tested with GET /_apis/connectionData … which required scopes are missing") · **Depends on:** AL-042, AL-060
- **Scope:** `GET {org}/_apis/connectionData` → signed-in identity; scope probes with read calls per area — Work Items (`_apis/wit/wiql` on a trivial query), Code (`_apis/git/repositories?$top=1`), Build (`_apis/build/builds?$top=1`); a 401/403 marks that scope missing. Write scopes cannot be proven without writing: mark them "verified on first write" and map a later 403 to `ADO_SCOPE_MISSING`. Load projects for the Default project dropdown after a successful test.
- **Acceptance criteria:**
  - [ ] Saved row shows "signed in as <name>" and masked token, as on artboard 5. (open: data side done, rows carry `identity` and `maskedToken` and `formatAdoConnectionDetails` returns the artboard text, proven by unit and e2e tests; drawing the row is AL-046)
  - [ ] A PAT without Build (read) shows the Build scope chip as missing. (open: data side done, `missingScopes: ['build']` and `adoScopeChips()` give the missing state; drawing the chip is AL-046; Kyle to confirm against a real org that a PAT without vso.build gets 401/403 on `{project}/_apis/build/builds?$top=1`)
  - [ ] Expiry shown when known (Q10). (open: data side done, optional user-entered `expiresAt` is stored and `formatTokenExpiry`/`tokenExpiryState` warn 7 days before; the date input and its display are AL-046)
- **Tests:** MSW handlers for each probe outcome.

#### AL-044 · Claude connection
- **Design:** §7, §8, Q4 · **Depends on:** AL-042
- **Scope:** Detect an existing Claude Code login (start a throwaway SDK query and read `accountInfo()` / the auth status message, or the documented auth probe) and offer "Use my Claude Code login"; or store an API key (passed to sessions as `ANTHROPIC_API_KEY` env, AL-100). Test = one-token request (`maxTurns: 1`, tiny prompt) and report account/org.
- **Acceptance criteria:**
  - [ ] With a logged-in Claude Code on the machine, the tab shows "Connected · using your Claude Code login" with no key entered. (open: data path done, `connections:detectClaude`, the login test and `claudeConnectionStatusLine` returning exactly this text are proven in unit tests and e2e against a fake `claude` CLI; the Claude tab is AL-046; Kyle to confirm real `accountInfo()` fields and the login test with a claude.ai subscription)
  - [ ] An invalid API key shows a clear error and stays red. (open: data path done, the test returns "Anthropic refused this API key…" and the saved row keeps status `error` through re-tests and a relaunch (e2e); the red row is AL-046; the real CLI's output for a revoked key is modelled on SDK 0.3.292 types, not observed)

#### AL-045 · MCP server entries
- **Design:** §7 MCP servers, §8 · **Depends on:** AL-042
- **Scope:** Add/edit/remove MCP servers: name, transport (stdio command + args | HTTP/SSE URL), optional token (secret, injected as env or header at launch). Built-in entry for the ADO MCP server per connected org (AL-108). Test = start the server and list its tools.
- **Acceptance criteria:**
  - [ ] A server whose command fails to start shows the error output in the row. (open: data path done, the error output is the row's `statusMessage` on `connections:list` / `connections:save` and is proven over IPC in e2e; the MCP row that draws it is AL-046)
  - [x] Tokens for MCP servers are stored in SecretStore, never in settings.

#### AL-046 · Connections modal UI
- **Design:** §8, artboard 5, R4 · **Depends on:** AL-043, AL-044, AL-045, AL-027, AL-029
- **Scope:** `features/connect-ado`, `connect-claude`, `connect-mcp` + `widgets`-free composition in the modal: header ("Tokens are encrypted on this computer and never shown again after you save them"), tabs Azure DevOps / Claude / MCP servers with status dots, saved rows (Connected pill, url · signed in as · masked token · expires, Replace / Remove), "Add an organisation" form (Organisation URL, Default project "Loaded after the token is tested", PAT + Test connection, scope chips, help text naming User settings › Personal access tokens), footer lock note + Cancel + Save connections. Opens from the header and from any reconnect action, focused on the right row.
- **Acceptance criteria:**
  - [x] Matches artboard 5.
  - [x] Save is disabled until the draft row has passed Test connection.
  - [x] Opening via a Reconnect toast lands on that org's row with the PAT field focused.

#### AL-047 · First-run flow and repo picker
- **Design:** §8 ("opens automatically on first run and blocks the board"), §5 Processes example · **Depends on:** AL-046, AL-081
- **Scope:** `processes/first-run`: if no ADO org or no Claude connection → blocking Connections modal → "Pick a repo" step using the native folder dialog (AL-081) → board for that repo.
- **Acceptance criteria:**
  - [x] Fresh profile: board is not reachable until one ADO org and Claude are connected and a repo is chosen.
  - [x] Second launch goes straight to the board for the last repo.

#### AL-048 · Credential failure handling
- **Design:** §8 last bullet, §13 PAT risk · **Depends on:** AL-046, AL-100, AL-030
- **Scope:** Any 401 from ADO (client or ADO MCP inside a session) marks that org red, pauses only the agents whose work items belong to that org (interrupt + hold their input queue), and raises an error toast with Reconnect. After a successful reconnect, paused sessions resume with a short "Connection restored" user turn.
- **Acceptance criteria:**
  - [x] Agents on another org keep running.
  - [x] Reconnect → resume works without restarting the app.

---

### E4 — Azure DevOps (`packages/ado-client`, main-process service)

#### AL-060 · ado-client core
- **Design:** §7 · **Depends on:** AL-001
- **Scope:** `createAdoClient({ orgUrl, pat, fetch })`: Basic auth header from the PAT, `api-version=7.1`, JSON + zod-validated responses, continuation-token paging, 429/503 retry honouring `Retry-After` (max 3), error mapping (401 → `ADO_UNAUTHORIZED`; 403 or the 203-login-page case → `ADO_SCOPE_MISSING`), request timeout, and redaction of the auth header in any error.
- **Acceptance criteria:**
  - [x] Every exported call returns `Result<T>`.
  - [x] No error message or log line contains the PAT (test).
- **Tests:** MSW for paging, retry, each error class. (done: 124 MSW-backed Vitest tests)

#### AL-061 · Sprints (iterations)
- **Design:** artboard 1 header ("Sprint 42 · 7 – 20 Oct") · **Depends on:** AL-060
- **Scope:** Teams for a project; iterations for a team (`_apis/work/teamsettings/iterations`), current one via `$timeframe=current`; DTO `{ id, name, path, start, finish }`.
- **Acceptance criteria:**
  - [x] Current sprint is pre-selected; past and future sprints are selectable. (data and selection level: `listSprints` + `pickSprint`; the dropdown is AL-142. MSW only, not checked against a real org)

#### AL-062 · Work items: sprint list, search, get
- **Design:** artboard 2, R6 · **Depends on:** AL-060
- **Scope:** WIQL for items in an iteration path (stories, bugs, tasks; configurable types) → batch `workitems?ids=` with fields `System.Id, Title, WorkItemType, State, AssignedTo, IterationPath, Description, AcceptanceCriteria`; search by numeric id or title `CONTAINS`; DTO includes state category for colouring and the web URL ("Open in Azure DevOps ↗").
- **Acceptance criteria:**
  - [x] Sprint list returns ≥ 200 items with paging.
  - [x] Searching "71273" or "frmJobControl" finds #71273.

#### AL-063 · Work item write-back (comments, state)
- **Design:** §7 ADO write-back · **Depends on:** AL-060
- **Scope:** Add comment (Comments API); optional state transition (only when enabled in settings; default off).
- **Acceptance criteria:**
  - [ ] A comment posted by the app is visible in ADO with a recognisable prefix ("Agent Lanes ·"). (open: proven against an MSW fake of the Comments API (post, read back with the prefix, `fromAgentLanes: true`); needs one manual check by Kyle with a real PAT, which also confirms `format=html` on 7.1-preview.4, that the middle dot survives, and the status of a failed `/rev` test op (handled as 409 or 412). Comments API and the settings-gated state transition (`adoStateTransitions`, default off) are done)

#### AL-064 · Pull requests: create, link, checks
- **Design:** §7, §9 step 5 alternative, artboard 6 "PR open" · **Depends on:** AL-060
- **Scope:** Create PR (source = ticket branch, target = base branch, title/description, `workItemRefs`); get PR (status, merge status); checks = policy evaluations + build statuses → `{ passed, total, failing[] }`; complete/abandon detection for Done.
- **Acceptance criteria:**
  - [ ] Card shows "PR !10612 · 3 / 4 checks". (open: data side done, `getPullRequestSnapshot` + `formatPullRequestActivity` yield exactly this string from the artboard 6 MSW fixture; rendering waits for AL-065 (IPC), AL-144 and AL-181)
  - [ ] A completed PR moves the ticket to Done (via AL-181). (open: detection done, `isPullRequestClosed`/`pullRequestOutcome` give closed/merged or closed/abandoned plus `closedAt`; moving the ticket is AL-181. Also needs a check against a real ADO org: `includeWorkItemRefs` on the single-PR GET, the preview api-versions, and PAT scopes for policy evaluations and the artifact link)

#### AL-065 · Main ADO service, IPC and MSW fixtures
- **Depends on:** AL-061–AL-064, AL-042
- **Scope:** `AdoService` picks the client per org from ConnectionsService; channels `ado:listSprints`, `ado:listWorkItems`, `ado:searchWorkItems`, `ado:getWorkItem`, `ado:getComments`, `ado:createPullRequest`, `ado:getPullRequest`. Shared MSW handler set + fixture data (sprint 42, items #71273, #71330, #71335, #71341 from the artboards) used by unit, integration and e2e tests.
- **Acceptance criteria:**
  - [x] Every channel has contract schemas and a handler test.

#### AL-066 · Renderer ADO queries and refetch policy
- **Design:** §6 ("refetches on window focus and every 60 s while the board is open") · **Depends on:** AL-065
- **Scope:** `entities/ado-work-item` (model + `WorkItemChip`), query hooks `useSprints`, `useWorkItems(sprint)`, `useWorkItemSearch(q)`, `useWorkItem(id)`, `usePullRequest(id)`; key factory (`['ado','workItem',id]` etc.); `refetchInterval: 60_000` only while the board is visible.
- **Acceptance criteria:**
  - [x] No ADO polling while the window is hidden or minimised.

---

### E5 — Git and worktrees (main-process service)

#### AL-080 · Git runner
- **Depends on:** AL-001
- **Scope:** `git(args, { cwd })` via `execFile` (no shell, so no injection), timeout, typed errors, porcelain parsers (`status --porcelain=v2`, `worktree list --porcelain`, `rev-list --left-right --count`); minimum git version check (≥ 2.38) on start-up with a clear message.
- **Acceptance criteria:**
  - [x] Branch names with spaces or quotes cannot break a command (test).
- **Tests:** against temp repos (AL-221 kit).

#### AL-081 · Repo registry and folder picker
- **Design:** §8 ("Repo paths are picked with a native folder dialog"), artboard 1 Repo dropdown · **Depends on:** AL-080, AL-041
- **Scope:** `repos:add` opens `dialog.showOpenDialog` in main, validates a git work tree, detects default branch (`origin/HEAD`, fallback `main`), stores the repo; `repos:list`, `repos:remove`; worktree root defaults to `<repo>/../.agent-lanes/` (§9).
- **Acceptance criteria:**
  - [x] Picking a non-git folder shows an error and stores nothing.

#### AL-082 · Branch and worktree naming
- **Design:** §9, artboard 2 Workspace ("Worktree 71273-cutover-frmjobcontrol-to") · **Depends on:** —
- **Scope:** Pure function `<id>-<slug>` from the work item title: lowercase ASCII, words joined by `-`, max 32 chars cut on a word boundary where possible, dedupe with `-2`, `-3` against existing branches; no-ticket tickets use `nt-<yyyymmdd>-<slug>`; user can edit the name in the modal, re-validated with `git check-ref-format`. Sub-branches `sub/<ticket-id>-<name>`.
- **Acceptance criteria:**
  - [x] Table-driven tests cover unicode, punctuation, long titles and collisions.

#### AL-083 · Create the ticket worktree
- **Design:** §9 step 1 · **Depends on:** AL-081, AL-082
- **Scope:** `git fetch origin <base>` then `git worktree add <root>/<id> -b <branch> origin/<base>` (or local base when offline); refuse if the path exists and is not ours; record path + branch on the ticket.
- **Acceptance criteria:**
  - [x] Two tickets get two worktrees and never share a branch (R8).
  - [x] Failure leaves no half-created worktree or branch.

#### AL-084 · Sub-agent worktrees (WorktreeCreate hook)
- **Design:** §9 step 3 · **Depends on:** AL-083, AL-100
- **Scope:** Register SDK `hooks.WorktreeCreate` in each session (Decision D9): create `sub/<ticket>-<name>` off the ticket branch at `<root>/<id>--<name>` and return `worktreePath`; `WorktreeRemove` keeps the worktree (removed only on Archive). Read-only sub-agents (explore, reviewer) are not isolated and share the ticket worktree. Record each sub-branch on the ticket.
- **Acceptance criteria:**
  - [x] Two writer sub-agents edit in parallel without touching each other's files.
  - [ ] Sub-branches appear in the Sub-branches panel with ahead counts. (open: sub-branches are recorded on the ticket and `branches:status` reports their ahead counts; the panel that draws them is AL-178)

#### AL-085 · Branch status
- **Design:** artboard 3 Sub-branches ("4 ahead · Ready") · **Depends on:** AL-083
- **Scope:** `branches:status(ticketId)` → ticket branch vs base, each sub-branch vs ticket branch: ahead/behind, dirty, ready (= clean and its sub-agent finished). Query key `['branches', ticketId]`; refreshed on `agent:subagent` completion and after merges.
- **Acceptance criteria:**
  - [x] A dirty sub-worktree is never "Ready".

#### AL-086 · Merge sub-branches → ticket branch
- **Design:** §9 step 4, R9 · **Depends on:** AL-084, AL-085
- **Scope:** Merge every ready sub-branch into the ticket branch in creation order (`--no-ff`); stop at the first conflict, leave the merge in progress in the ticket worktree, return `MERGE_CONFLICT` with the file list; offer "Hand to lead agent" (user turn listing conflicts) or "I'll resolve it" (open files in the user's editor).
- **Acceptance criteria:**
  - [x] Successful merges invalidate `['branches', id]` and `['ado','workItem',id]`.
  - [x] After a conflict, nothing past the conflicting branch is merged.

#### AL-087 · Merge worktree → main
- **Design:** §9 step 5, R9, §13 risk, Q1, Q2 · **Depends on:** AL-085
- **Scope:** Confirm modal naming source and target; warning when QA has not passed; refuse with `GIT_DIRTY` when the worktree has uncommitted changes; merge into the base branch in the main checkout and push; optional block until the PR is approved (setting). Behaviour after Q1 is answered may switch this to "always via PR".
- **Acceptance criteria:**
  - [x] Cannot merge with uncommitted changes.
  - [ ] Card moves to Done with "Merged into main · 15:20". (open: the record and store move to Done and `mergedActivityText` gives the string as the card activity; showing it on the card waits for AL-144 and the confirm modal for AL-174)

#### AL-088 · Archive
- **Design:** §9 step 6 · **Depends on:** AL-083
- **Scope:** User-chosen Archive removes the ticket worktree and its sub-worktrees (`git worktree remove`, then prune), optionally deletes merged branches; handles Windows long paths and locked files (retry, report partial removals); ticket record moves to an archive list.
- **Acceptance criteria:**
  - [x] Never runs automatically.
  - [x] Refuses when a worktree has unmerged commits unless the user confirms a second time.

#### AL-089 · Diff provider
- **Design:** artboard 3 Diff tab · **Depends on:** AL-083
- **Scope:** `git:diff(ticketId, { against: base | sub-branch })` → files with status and stats, and per-file unified diff on demand (size-capped).
- **Acceptance criteria:**
  - [x] Binary and very large files show a placeholder, not raw content.

#### AL-090 · Start-up reconciliation
- **Design:** §6 last bullet · **Depends on:** AL-083, AL-101
- **Scope:** On launch, read `git worktree list --porcelain` for each repo and match ticket records; rebuild tickets with their stage, model/effort and session id; flag orphans (record without worktree → "Worktree missing"; worktree under our root without record → offer "Adopt" or "Ignore").
- **Acceptance criteria:**
  - [ ] Restarting the app shows the same board as before, with sessions resumable. (open: unit tests and `e2e/reconcile.spec.ts` show identical boards and session ids across restarts and the store is rebuilt; cards drawing the flags wait for AL-143/AL-144 and resuming sessions for AL-110)

---

### E6 — Agent sessions (Claude Agent SDK, main process)

API facts used here were read from `@anthropic-ai/claude-agent-sdk` 0.3.292 type definitions
(`sdk.d.ts`) on 2026-10-07. Model IDs per Decision D10.

#### AL-100 · Session manager core
- **Design:** §4 Session manager, §7 · **Depends on:** AL-083, AL-044
- **Scope:** One `query({ prompt: AsyncIterable<SDKUserMessage>, options })` per ticket in streaming-input mode, with an input queue the app pushes into. Options: `cwd` = ticket worktree; `projectConfigRoot` = repo main checkout (Decision D12); `model`; `effort`; `thinking: { type: 'adaptive' }`; `settingSources: ['user', 'project', 'local']`; `includePartialMessages: true`; `env` with the connection's credentials; `abortController`; `mcpServers` (AL-103, AL-108); `hooks` (AL-084); `canUseTool`/`permissionMode` (AL-109); `resume` when a session id exists (AL-110). First user turn = job description + work item summary + selected skills + stage protocol (AL-103). API surface for the rest of E6: `send(ticketId, message)`, `interrupt`, `setModel`, `setEffort`, `stop`, `status`.
- **Acceptance criteria:**
  - [x] Two tickets run concurrently in different worktrees without cross-talk.
  - [x] Closing a ticket's session releases its process (no orphan `claude` processes; check Task Manager in AL-213).
  - [ ] The SDK's native binary is found in dev and in the packaged app (AL-007). (open: dev uses AL-044's `resolveClaudeExecutable`; the packaged build was not run against a real Claude install)
- **Tests:** with the fake SDK from AL-221.

#### AL-101 · Ticket records
- **Design:** §6, R2, Decision D8 · **Depends on:** AL-041
- **Scope:** App-written JSON per ticket in `<userData>/tickets/<repoKey>/<ticketId>.json`: ADO ref, repo, branch, worktree path, sub-branches, stage + stage timestamps, gates, model, effort, skills, session id, last build/run, design link + spec versions (E11). Atomic write (temp + rename), zod-validated on read, debounced writes.
- **Acceptance criteria:**
  - [x] Killing the app mid-write never corrupts a record (test with interrupted write).
  - [x] Nothing is written inside a worktree (keeps it clean for GIT_DIRTY).

#### AL-102 · Output normalisation and transcript buffer
- **Design:** §6 Live events, artboard 3 Output · **Depends on:** AL-100, AL-012
- **Scope:** Map `SDKMessage`s to an `AgentOutputEvent` union: `text-delta` (partial assistant text), `text`, `tool` (Read/Edit/Write/Bash/Grep/Glob/Agent→"Spawn"/MCP, with a one-line mono detail and stats like `+214 −0`, `1,842 lines`, `0 errors · 2 warnings`), `tool-result` (summary only), `system` ("Plan approved by Kyle · moved to Implementing"), `result` (usage, cost, duration). Keep a per-ticket ring buffer (e.g. last 5,000 events) in main; `agent:getTranscript(ticketId)` returns it so a reloaded renderer or newly opened drill-in can backfill; older history from `getSessionMessages()`.
- **Acceptance criteria:**
  - [ ] Every tool row on artboard 3 can be produced from real SDK messages. (open: covered against recorded-shape fake SDK messages only, never a real session)
  - [x] Opening a drill-in mid-run shows prior output, then continues live with no gap or duplicate.

#### AL-103 · Stage protocol: `agent_lanes` MCP server
- **Design:** §7 Stage tracking · **Depends on:** AL-100
- **Scope:** In-process server via `createSdkMcpServer({ name: 'agent_lanes', tools: [...] })` with `tool()` definitions: `set_stage({ stage, summary })`, `report_activity({ text, progress })` (drives the card's activity line and progress bar). Allowed without permission prompts. Stage protocol text appended to the system prompt: report each stage change; Code review and QA may send work back to Implementing (§9 diagram loop). Emits `agent:stage`.
- **Acceptance criteria:**
  - [ ] A `set_stage` call moves the card within one frame of the event. (open: the store updates on the event batch and is tested; not measured with a live agent driving the card)
  - [x] Invalid stage transitions are rejected with a tool error the agent can read.

#### AL-104 · Stage gates
- **Design:** §9 step 2, artboard 2 Stage gates, artboard 6 "Needs approval" · **Depends on:** AL-103
- **Scope:** When `set_stage` targets a stage whose *entry* is gated (defaults: Planning approval before Implementing; Create PR approval), the tool call does not return until the user decides: Approve → tool result "approved"; Request changes → tool result with the user's note. Card shows "Needs you · approve plan"; `agent:gate` event; `agent:resolveGate` channel. Gates are per ticket and editable from the drill-in.
- **Acceptance criteria:**
  - [ ] While waiting, the session uses no tokens and the card is amber. (open: the amber card is tested; "no tokens" rests on the tool call staying open and was not measured against a real account)
  - [x] Turning a gate off while waiting releases it as approved.

#### AL-105 · Messages, skills and pause
- **Design:** §7 Skills, artboard 3 composer · **Depends on:** AL-100
- **Scope:** `agent:send({ ticketId, text, priority })` pushes an `SDKUserMessage` (`priority: 'next'` default; `'now'` for "steer now"). Skill chips send `/skill-name` as the next user turn so they behave as in the terminal. Pause = `interrupt()`; the input queue holds further messages until Resume.
- **Acceptance criteria:**
  - [x] A message sent mid-turn is delivered without killing the turn.
  - [ ] `/code-review` from a chip runs the skill exactly as typed in the terminal. (open: the exact `/code-review` text reaching the input stream is tested; running the skill needs a real Claude Code session)

#### AL-106 · Live model and effort change
- **Design:** R7, §7, artboard 6 "Model switching" · **Depends on:** AL-100
- **Scope:** `agent:setModel` → `Query.setModel(id)`; `agent:setEffort` → `Query.applyFlagSettings({ effortLevel })`. Ticket shows "Switching · applies next turn" until the next assistant message reports the new model (or the next turn starts), then clears. "Apply model now" = interrupt, apply, then a "continue" user turn.
- **Acceptance criteria:**
  - [x] Opus → Sonnet mid-run shows "Opus → Sonnet · High" then clears when applied.
  - [x] Effort changes persist to the ticket record.

#### AL-107 · Sub-agent tracking
- **Design:** artboard 3 Sub-agents, §6 `agent:subagent` · **Depends on:** AL-102
- **Scope:** Build the tree from Agent/Task tool uses and `parent_tool_use_id`, `SDKTaskStarted/Updated/Progress/Notification` messages, and `SubagentStart/Stop` hooks: name, agent type, model · effort, status (Queued/Running/Done/Failed), one-line activity, tokens, branch or "read-only". Optional `forwardSubagentText` for a nested transcript.
- **Acceptance criteria:**
  - [x] Panel counts ("2 running · 1 done · 1 queued") match the SDK's task states. (at the data level: a tracker test drives the SDK task messages and checks the counts and `subagentCountsLabel`, and the card store test checks they reach the card; the panel itself is AL-177)

#### AL-108 · MCP injection and status
- **Design:** §7 MCP servers, artboard 1 "MCP online" · **Depends on:** AL-100, AL-045
- **Scope:** Each session gets `agent_lanes` (AL-103), the ADO MCP server for the work item's org (official Azure DevOps MCP server, PAT as env), and the user's MCP servers. `mcpServerStatus()` aggregated into the header pill (all online / N failing); `reconnectMcpServer` on failure.
- **Acceptance criteria:**
  - [ ] The agent can read and comment on its own work item through the ADO MCP server. (open: `session-mcp.test.ts` proves the session gets the work item's org ADO server with the PAT; reading and commenting needs a live session against a real ADO org)
  - [x] A failing server turns the pill amber with the server name on hover.

#### AL-109 · Permission policy for headless sessions
- **Design:** §4 (headless sessions), Q9 · **Depends on:** AL-100 · **Policy:** the proposed default (Decision D18), configurable in settings
- **Scope:** Choose `permissionMode` and an allow-list (proposal: `acceptEdits`, plus Bash allow-list for git read commands, build and test commands of the repo); everything else goes through `canUseTool`, which raises "Needs you · permission" on the card with Allow once / Allow for this ticket / Deny.
- **Acceptance criteria:**
  - [ ] No session ever blocks on an invisible prompt. (open: `permission-service.test.ts` proves every session gets `canUseTool` and each request is shown on the card through `agent:permission`, on the fake SDK only; needs a check with a real Claude session)
  - [ ] Decisions are logged in the ticket's output. (open: unit tests write the Allow/Deny lines to the transcript; not yet seen in a real session's output)

#### AL-110 · Crash recovery
- **Design:** §12 ("restarted from its saved session id in the same worktree"), artboard 6 toast · **Depends on:** AL-100, AL-101
- **Scope:** Detect session loss (stream error, process exit, no output past a watchdog while "running") → `SESSION_LOST` → toast "MCP bridge lost the session · cc-71288 stopped responding. The worktree is intact." with Reconnect / Dismiss; Reconnect = new `query()` with `resume: sessionId`, same cwd. Auto-retry once before asking. Never deletes the worktree.
- **Acceptance criteria:**
  - [ ] Killing the `claude` process mid-run leads to a resumed session with the history intact. (open: tested with the fake SDK only: a failed stream, an exit or a watchdog stall starts a new `query()` with `resume` = the saved session id and `cwd` = the worktree, plus a "continue" turn when lost mid-turn; killing a real `claude` and checking the history needs a real account)

#### AL-111 · Concurrency cap and Queued lane
- **Design:** §13 risk ("per-repo cap on concurrent agents, and a queued lane"), Q5 · **Depends on:** AL-100
- **Scope:** Per-repo max running agents (setting, default 3); extra launches land in Queued with "Waiting for a free slot"; FIFO start when a slot frees; manual "Start now" overrides.
- **Acceptance criteria:**
  - [x] Never more running sessions per repo than the cap.

#### AL-112 · Build result as next-turn context
- **Design:** §10 last bullet · **Depends on:** AL-100, AL-132
- **Scope:** When a build finishes, push an `SDKUserMessage` with `shouldQuery: false` (Decision D11) containing the result summary and the first N errors, so it rides along with the agent's next turn without starting one.
- **Acceptance criteria:**
  - [ ] After a user-started failed build, the agent's next turn mentions the errors without being told. (open: the fake-SDK test shows the errors reach the session's input with `shouldQuery: false`, ahead of the user's next message, without starting a turn; whether the model mentions them needs a real Claude session)

#### AL-113 · Usage, tokens and session pill
- **Design:** artboard 3 ("Session cc-71273 · 1h 12m · 412k tokens"), Lead agent "212k tokens" · **Depends on:** AL-102
- **Scope:** Aggregate usage from result/assistant messages per session and per sub-agent; elapsed time; context usage via `getContextUsage()`; cost (shown in a tooltip only).
- **Acceptance criteria:**
  - [x] Totals match the SDK's result usage within rounding.

#### AL-114 · Skill discovery
- **Design:** artboard 2 Skills, artboard 3 shortcuts · **Depends on:** AL-100
- **Scope:** `skills:list(repo)` from `supportedCommands()` of a session started with the repo's config (cached per repo, refreshed on demand); returns name + description; filters to skills.
- **Acceptance criteria:**
  - [ ] The repo's own `.claude/skills` and the user's skills both appear. (open: merging and filtering are tested with the fake Agent SDK and the e2e fake `claude`; whether real Claude Code lists both through `supportedCommands()` needs a real login on a repo with `.claude/skills`)

#### AL-115 · ADO write-back on stage change
- **Design:** §7 ADO write-back · **Depends on:** AL-103, AL-063
- **Scope:** On each stage change post a short comment ("Agent Lanes · Implementing — plan approved by Kyle"); rate-limited; off switch per repo.
- **Acceptance criteria:**
  - [x] One comment per stage change, never duplicated after a resume.

---

### E7 — Build and run (main-process service)

#### AL-130 · Build/run command detection and overrides
- **Design:** §10 · **Depends on:** AL-081
- **Scope:** Detect per repo: `.sln`/`.csproj` → `dotnet build <sln> -c Debug` / `dotnet run --project <proj>`; `package.json` → its `build` / `start` (or `dev`) scripts with the repo's package manager. Overrides stored per repo in settings (edited in AL-146), never in a file.
- **Acceptance criteria:**
  - [x] OnSite Companion resolves to `dotnet build OnSite.sln -c Debug`.

#### AL-131 · Job queue
- **Design:** §10 ("at most 2 at once by default") · **Depends on:** AL-011
- **Scope:** FIFO queue with concurrency from settings, per-worktree serialisation (one job per worktree at a time), cancellation, `build:queued` status.
- **Acceptance criteria:**
  - [x] Third concurrent build waits; cancelling a queued job removes it.

#### AL-132 · Build job and log parsing
- **Design:** §10, artboard 6 "Build failed" · **Depends on:** AL-130, AL-131, AL-012
- **Scope:** Spawn in the worktree, stream `build:log` lines (batched), parse MSBuild (`file(line,col): error CS0246: …`) and tsc/eslint formats into diagnostics; result `ok` or `BUILD_FAILED` with counts; store "Last build 14:02 · succeeded" on the ticket.
- **Acceptance criteria:**
  - [ ] Card shows "Build failed · 3 errors" and the first error as activity. (open: data path done and tested in unit and e2e `build-job.spec.ts`; `buildCardState()` returns this footer and activity, but no agent card draws it until AL-160s)

#### AL-133 · Run job, port and URL
- **Design:** §10 Run · **Depends on:** AL-132
- **Scope:** Build if the last build is stale, then start as a child process; web projects get a free port (`ASPNETCORE_URLS` / `PORT`), detect the listening URL from output, card shows "Running · localhost:5080" (click opens the browser); desktop exe launches its own window. `run:status` events.
- **Acceptance criteria:**
  - [x] Two tickets run the same web app side by side on different ports.

#### AL-134 · Stop and process-tree kill
- **Design:** §10 Stop · **Depends on:** AL-133
- **Scope:** Kill the whole tree (`taskkill /PID <pid> /T /F` on Windows, process group elsewhere); app quit stops every run it started.
- **Acceptance criteria:**
  - [x] No orphan `dotnet` or `node` processes after Stop or quit.

#### AL-135 · Build log tab
- **Design:** artboard 3 tabs, §10 · **Depends on:** AL-132, AL-029
- **Scope:** Virtualised mono log, warnings amber and errors red, "jump to next error", copy, follow-tail toggle.
- **Acceptance criteria:**
  - [x] 50,000-line log scrolls smoothly.

---

### E8 — App shell and board (artboard 1)

#### AL-140 · App router and lazy pages
- **Design:** §5 App layer, §12 Performance · **Depends on:** AL-003
- **Scope:** Typed in-app router (Decision D13): `board`, `ticket/:id`, `ticket/:id/design`; history back/forward (mouse buttons, Alt+←); pages lazy-loaded behind Suspense.
- **Acceptance criteria:**
  - [x] Each page is its own chunk.

#### AL-141 · Agent ticket entity and store
- **Design:** §6 Live client state · **Depends on:** AL-015, AL-101
- **Scope:** `entities/agent-ticket`: model types, Zustand store keyed by ticket id (stage, activity, progress, model/effort/switching, gate, build/run, PR, sub-agent counts, needs-you reasons), selectors per lane and per ticket so a streaming ticket re-renders only itself; event handlers registered with the hub.
- **Acceptance criteria:**
  - [x] A burst of output on one ticket does not re-render other cards (React Profiler test).

#### AL-142 · Board header
- **Design:** artboard 1 · **Depends on:** AL-141, AL-066, AL-024, AL-025, AL-081
- **Scope:** Logo + "Agent Lanes"; Repo dropdown (registered repos + "Add repo…"); Sprint dropdown; live pills (`N running`, `N need you`, `N queued`, MCP status); Connections icon button; "+ New agent ticket". Sub-header line "Sprint 42 · 7 – 20 Oct · 8 agent tickets", title "Agent board", legend.
- **Acceptance criteria:**
  - [x] Counts update live from the store; "need you" pill opens a filtered view or scrolls to the first amber card.

#### AL-143 · Lanes
- **Design:** artboard 1, artboard 6 "Empty lane" · **Depends on:** AL-141
- **Scope:** Lanes Queued, Planning, Implementing, Code review, QA, Create PR, then a collapsed vertical Done lane ("7 · Done · merged this sprint", expandable). Count badge per lane (amber when any card needs the user). Empty-lane copy per lane ("Nothing in QA · Tickets land here once code review passes."). Collapsible lanes persisted (AL-041). Horizontal scroll below the min width.
- **Acceptance criteria:**
  - [ ] Matches artboard 1 at 1440 × 960. (open: lanes, count badges, Done strip, cards and dock match in the 1440 × 960 e2e screenshot; still missing are the cards' ADO state text (AL-066 queries), live activity and progress (AL-103 events), and the header and legend (AL-142))

#### AL-144 · AgentTicketCard and its states
- **Design:** artboard 6, R6 · **Depends on:** AL-141, AL-025, AL-028
- **Scope:** `entities/agent-ticket/ui/AgentTicketCard`: IdChip + ADO state, title, activity row (violet dot), progress bar, footer "Model · Effort" + "N sub-agents", optional status band. States: Running, Selected, Needs approval, Model switching, Build failed, QA gap, PR open, Merged; plus Queued ("Waiting for a free slot") and Needs permission (AL-109). Click opens the drill-in; keyboard focusable.
- **Acceptance criteria:**
  - [ ] Each state on artboard 6 reproduced in the gallery (AL-032) and from real events. (open: every state is built and tested through the store actions that main-process events drive (`AgentTicketCard.test`); the gallery is AL-032, and `agent:stage`/`agent:gate`/`agent:status` payloads are still bare, so only `build:queued` and `agent:output` reach the card in the running app until AL-103, AL-104, AL-106, AL-107, AL-109 and AL-132 wire the rest)

#### AL-145 · Live dock
- **Design:** artboard 1 bottom bar · **Depends on:** AL-141
- **Scope:** Glass dock with `Live` pill, the latest three timestamped events across tickets (amber for needs-you events), "Sub-agents N", "Builds N"; clicking an event opens its ticket.
- **Acceptance criteria:**
  - [x] Dock updates no more than once per frame under load. (`LiveDock.test`: 800 store commits per frame give one render per frame; e2e shows a `build:queued` event from main reaching "Builds 1")

#### AL-146 · Settings panel (repo and defaults)
- **Design:** §10 ("override them in the repo's settings panel"), R5 — no artboard; build with E2 primitives · **Depends on:** AL-041, AL-130, AL-029
- **Scope:** Per repo: base branch, worktree root, build/run commands, max concurrent agents, ADO write-back on/off. Global: default model/effort, default gates, default skills, build queue size, ADO state transitions on/off. Opened from the Repo dropdown and from a header menu.
- **Acceptance criteria:**
  - [x] Every setting the app uses is editable here or in Connections; no other place. (`SettingsPanel.test` checks every key of `SettingsSchema`, `AgentDefaultsSchema` and `RepoSettingsSchema` has a control; exceptions are `version`, ui prefs and the repo path, picked through Add repo…)
  - [ ] Opened from the Repo dropdown and from a header menu. (open: the panel takes `repoPath`/`section` props, but the Repo dropdown and header menu are AL-142; today it opens from the interim header's Settings button)

---

### E9 — New agent ticket (artboard 2)

#### AL-160 · New-ticket modal shell and form state
- **Design:** artboard 2, §1 goal ("under a minute") · **Depends on:** AL-029
- **Scope:** `processes/new-ticket` with `features/create-ticket`: two-column modal, `useReducer` form state, validation, Cancel, "Launch agent →", footer summary ("Launch starts a headless Claude Code session in its own worktree via the MCP bridge. Linked to #71273. Opus · XHigh.").
- **Acceptance criteria:**
  - [x] Keyboard-only path from open to launch works. (e2e `new-ticket.spec` drives the real app with Tab, arrows, typing and Enter from the board to Launch; `NewTicketModal.test` does the same with user-event)

#### AL-161 · Work item picker
- **Design:** artboard 2 left column · **Depends on:** AL-160, AL-066
- **Scope:** Segmented Sprint 42 / Search / No ticket; search field "Search by ID or title" (debounced); radio list rows (id, title, "Story · Active"); "Optional" label; items already running show their lane instead of a radio.
- **Acceptance criteria:**
  - [x] "No ticket" hides ADO fields and uses `nt-` naming.

#### AL-162 · Job description and skill chips
- **Design:** artboard 2 · **Depends on:** AL-160, AL-114
- **Scope:** "What should the agent do?" multiline field (prefilled from the work item's description/acceptance criteria as a quoted block the user can edit); Skills chips (mono, toggle, violet when selected) from AL-114, defaults from settings.
- **Acceptance criteria:**
  - [x] Selected skills are passed to the session and listed in its first turn. (AL-165's `tickets:launch` saves the selected skills on the record and the session's `buildFirstTurn` lists them)

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
  - [x] From a sprint item to a running Planning card in under a minute of user time. (e2e `launch.spec.ts`: #71273 from Sprint 42 → Launch → highlighted card in Planning, worktree and branch on disk, 17.7 s in total)

---

### E10 — Ticket drill-in (artboard 3)

#### AL-170 · Ticket page frame
- **Design:** artboard 3 · **Depends on:** AL-140, AL-141
- **Scope:** Top bar (← Board, repo / #id breadcrumb, session pill); meta chips (#id, "User story · Active · Sprint 42 · Kyle Richards", "Open in Azure DevOps ↗"); title; tab bar Output / Diff / Build log / ADO / Claude Design ↗; right column for sub-agents. Error boundaries per panel (AL-210).
- **Acceptance criteria:**
  - [x] Layout matches artboard 3 at 1440 wide; right column stacks under 1200.

#### AL-171 · Stage stepper and gate actions
- **Design:** artboard 3 stepper, §9 · **Depends on:** AL-104, AL-170
- **Scope:** Five steps: done (check + duration "12m"), current (number + "46%"), upcoming; gated step shows Approve / Request changes when waiting; gate toggles per stage.
- **Acceptance criteria:**
  - [x] Approving here and on the card are the same action and stay in sync.

#### AL-172 · Agent panel (model and effort)
- **Design:** artboard 3 Agent panel, R7 · **Depends on:** AL-106, AL-170
- **Scope:** `features/change-model`: model segmented (Opus/Sonnet/Haiku), effort pills (Low…Max), switching state.
- **Acceptance criteria:**
  - [x] Change shows "switching" until applied (AL-106).

#### AL-173 · Worktree panel (Build, Run, Stop)
- **Design:** artboard 3, R8 · **Depends on:** AL-134, AL-170
- **Scope:** `features/build-run`: branch name, Build / Run (primary) / Stop, "Last build 14:02 · succeeded", run status/URL; available at every stage.
- **Acceptance criteria:**
  - [x] Buttons reflect queued/running/stopped states from events.

#### AL-174 · Merge panel, confirm and conflict flows
- **Design:** artboard 3 Merge panel, §9 steps 4–5, R9 · **Depends on:** AL-086, AL-087, AL-170
- **Scope:** `features/merge-branches`: "Merge N sub-branches → <ticket branch>" and the dark "Merge worktree → main"; confirm modal (QA-not-passed warning, dirty refusal); conflict view listing files with "Hand to lead agent" / "Open in editor".
- **Acceptance criteria:**
  - [x] Merge buttons disable with a reason when nothing is ready or the worktree is dirty.

#### AL-175 · Output stream
- **Design:** artboard 3 Output, §12 Performance · **Depends on:** AL-102, AL-170
- **Scope:** Virtualised list (FlashList on react-native-web) of output events: system lines, tool rows (coloured verb chip + mono detail + stats), prose (bold for emphasis), streaming line with caret; auto-follow with "Jump to latest" when scrolled up; text selection (web file if needed, §13).
- **Acceptance criteria:**
  - [x] 10,000 events keep scrolling at 60 fps; store updates at most once per frame.

#### AL-176 · Composer
- **Design:** artboard 3 footer · **Depends on:** AL-105, AL-106, AL-175
- **Scope:** `features/send-message`: message box ("Message the agent — steer, answer, or add context"), Send, Pause/Resume, skill shortcut chips, "Apply model now"; Ctrl+Enter sends; "Steer now" option sends with `priority: 'now'`.
- **Acceptance criteria:**
  - [x] Messages sent while paused are queued and delivered on Resume. (`Composer.test.tsx` with a fake session, main's `session-messages.test.ts`, e2e `composer.spec.ts`)

#### AL-177 · Sub-agents panel
- **Design:** artboard 3 right column · **Depends on:** AL-107, AL-170
- **Scope:** `entities/sub-agent` (SubAgentNode): Lead agent card (violet, model · effort · role, tokens); children with status pill, description, model · effort, branch or read-only; counts in the header.
- **Acceptance criteria:**
  - [x] Reviewer queued until Code review shows "Starts at the Code review stage".

#### AL-178 · Sub-branches panel
- **Design:** artboard 3 · **Depends on:** AL-085, AL-177
- **Scope:** List of `sub/…` branches with "N ahead" and Ready, target branch label.
- **Acceptance criteria:**
  - [x] Refreshes after each merge and sub-agent completion.

#### AL-179 · Diff tab
- **Design:** artboard 3 tabs · **Depends on:** AL-089, AL-170
- **Scope:** File list with stats; unified diff viewer (mono, add/remove tints); compare ticket branch vs base or a sub-branch vs ticket branch.
- **Acceptance criteria:**
  - [x] Large diffs load per file on demand.

#### AL-180 · ADO tab
- **Design:** artboard 3 tabs, R6 · **Depends on:** AL-066, AL-170
- **Scope:** Work item fields, description and acceptance criteria (sanitised HTML → RN text), comments (including Agent Lanes write-backs), linked PR and checks.
- **Acceptance criteria:**
  - [x] Never renders raw HTML from ADO.

#### AL-181 · Create PR stage
- **Design:** §7 ADO write-back, §9 alternative to step 5, artboard 6 "PR open" · **Depends on:** AL-064, AL-104, AL-170
- **Scope:** On entering Create PR (after its gate), draft title/description from the agent's summary, let the user edit, create the PR, link the work item, show checks on the card and drill-in; PR completed/abandoned → Done.
- **Acceptance criteria:**
  - [ ] The PR is linked to the work item in ADO. (open: proven against the MSW fake ADO org, where the created PR carries `workItemIds [71273]`; the push to a real Azure Repos remote, `workItemRefs` and the artifact link with real PAT scopes need a manual check by Kyle against a real org)

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
  - [x] Decision recorded for: embed approach, artboard read path, design-thread path (Q11). (D111–D125)
  - **Open (manual, Kyle):** load a real claude.ai Design canvas in the view and try Google, email and SSO sign-in, then restart to confirm the session persists; run ClaudeDesign `{operation:'list'}` and `list_files` on a real project to confirm the live operations, how artboards are laid out and whether sizes are available, and that the tool is enabled for the team's org.

#### AL-191 · Design view service (WebContentsView)
- **Design:** §4 Design view, R10 · **Depends on:** AL-190, AL-011
- **Scope:** Main `DesignViewService`: one `WebContentsView` per open ticket canvas, partition `persist:claude-design`, attached to the main window and positioned over the renderer's canvas placeholder (bounds from a `ResizeObserver` → `design:setBounds`). Switching tabs or pages **hides** the view and never destroys it, so the canvas and its chat keep their state across stage changes (R11). Navigation allow-list (claude.ai and its auth domains); popups go to the OS browser; no preload, no Node, no access to app IPC (AL-011 trusted-sender check). LRU limit on live views (e.g. 3).
- **Scope update (AL-190 spike):** Partition `persist:claude-design`, no preload, sandboxed, no custom user agent (D111–D113). Popups to claude.ai and its auth hosts open as child windows in the same partition; all other popups go to `shell.openExternal` (D114). Navigation allow-list: claude.ai plus known auth hosts (enterprise SSO hosts may need adding). Call `cookies.flushStore()` on quit. Detect signed-out by redirects to claude.ai login pages. Reuse the fake-site pattern from `e2e/design-embed.spec.ts` for its e2e.
- **Acceptance criteria:**
  - [x] Moving between Output and Claude Design keeps the canvas exactly where it was (scroll, selection, chat draft). (service-level e2e `design-view.spec.ts`: same webContents, no reload, scroll, draft, selection and focus kept; the tab UI is AL-192)
  - [x] The design view cannot call any app channel (e2e).
  - Manual check by Kyle: real claude.ai email and SSO sign-in inside the view, and whether the team's SSO host must be added to `AUTH_HOSTS` (`apps/desktop/src/main/design/navigation.ts`).

#### AL-192 · Design tab page
- **Design:** artboard 4 · **Depends on:** AL-191, AL-140, AL-170
- **Scope:** `pages/design-tab`: compact ticket header (← Board, #id, title, stage pill "Implementing · 46%", model · effort), tab bar, browser-style bar (URL label "claude.ai/design · 71273 JobControl canvas", "Webview · signed in" pill, reload, pop-out to a separate window), canvas area, side panel with Embed mode, Hand off to agent, Attached to this ticket, and the design thread (AL-196). Reachable from the drill-in tab and directly from the board card.
- **Scope update (AL-190 spike):** The "Webview · signed in" pill reflects the view's real state (signed in, sign-in needed, sign-in failed); a failure links to MCP-link mode.
- **Acceptance criteria:**
  - [ ] Matches artboard 4. (open: header, browser bar, embed mode, hand-off checklist and attachments match; the design thread panel is AL-196, a working "Send N artboards to agent as spec" is AL-197 and the "Agent is watching this canvas" note is AL-198)
  - [x] Open and usable in every stage, Queued through Done (R11).

#### AL-193 · Link a canvas to a ticket
- **Design:** artboard 4 · **Depends on:** AL-101, AL-192
- **Scope:** Ticket record holds the canvas URL/id; "Link canvas" accepts a pasted claude.ai Design URL (or picks one if AL-190 finds a listing API); "Open in Claude ↗" deep link.
- **Scope update (AL-190 spike):** Store a `DesignCanvasRef` (D122) plus the view's last URL (from `did-navigate` / `did-navigate-in-page`) so a reopened canvas lands on the same artboard. Validate pasted links with `parseDesignCanvasUrl`. A listing API exists (ClaudeDesign `list_projects`), so "Link canvas" can also offer a picker through the design session. "Open in Claude ↗" opens the last URL, or `ref.url`, in the OS browser.
- **Acceptance criteria:**
  - [x] A linked canvas reopens on the right artboard after an app restart.

#### AL-194 · Embed mode switch and MCP-link fallback
- **Design:** §7, §13 risk, artboard 4 Embed mode · **Depends on:** AL-190, AL-192
- **Scope:** Segmented "Webview — Electron WebContentsView" / "MCP link — Open in Claude, sync via MCP"; persisted per ticket; if sign-in fails in the webview, offer MCP link mode with an explanation; in MCP link mode the canvas opens in Claude and selections sync back.
- **Scope update (AL-190 spike):** MCP-link mode needs the Claude Code claude.ai login (not an API key) plus Design consent (D115); the Claude tab in Connections shows Design access status and how to grant it (`claude /design login`, or claude.ai/design/settings). "Selections sync back" is not possible (no operation reads the selection, D117): dropped; the in-app artboard checklist is used in both modes.
- **Acceptance criteria:**
  - [ ] Hand-off and the design thread work in both modes. (open: the artboard checklist works and is tested in both modes; shipping is AL-197 and the design thread AL-196. The Connections Claude tab does not yet show Design access status (scope update). MCP-link mode against a real claude.ai login with Design consent needs a manual check by Kyle)

#### AL-195 · Artboard list and selection
- **Design:** artboard 4 "Hand off to agent" · **Depends on:** AL-190, AL-192
- **Scope:** List the canvas's artboards with names and sizes ("JobControl · desktop 1440×900"), checkboxes, synced with the canvas selection where the surface allows; read each artboard's structure/source for the spec (path chosen in AL-190).
- **Scope update (AL-190 spike):** List artboards with ClaudeDesign `list_files`/`read_file` (for artifact canvases, the Artifact tool's files listing) via the design session with structured output (D118); whether sizes come from file content or `render_preview` needs a real project. Claude Design pushes no events and polling an LLM is too costly: refresh on design-tab focus, a Refresh button, and after each design-thread reply. Proposed criterion wording: "refreshes on tab focus or Refresh after artboards are added or renamed".
- **Acceptance criteria:**
  - [ ] List refreshes when artboards are added or renamed on the canvas. (open: refresh on tab focus and Refresh is built and proven against the fake `claude` in unit and e2e tests, per the proposed AL-190 wording; a real claude.ai Design canvas must still confirm that ClaudeDesign `list_files`/`read_file` return names and sizes. Syncing with the canvas selection is not possible, D117)

#### AL-196 · Design thread at any stage (R11)
- **Design:** R11 · **Depends on:** AL-190, AL-192
- **Scope:** The user can talk to the design side of the ticket at any time, from Queued to Done, while the agent keeps running:
  - **Webview mode:** the canvas's own Claude chat inside the live view is the thread. AL-191 guarantees the view stays alive across stages and tab switches.
  - **MCP-link mode, or when the webview can't sign in:** an in-app Design thread panel (message list + box) backed by a per-ticket **design session** (a separate, lightweight Agent SDK session with the Claude Design MCP tools and the design-system tokens), independent of the lead agent's session (Q11 confirms).
  - Messages in the design thread never go to the implementation agent until shipped (AL-197).
  - Neither side blocks the other: no shared input queue, no shared gate.
- **Scope update (AL-190 spike):** The design session is an Agent SDK query with `tools` limited to ClaudeDesign (and Artifact for artifact canvases) plus the design-system tokens. Read operations are allowed automatically in `canUseTool`; writes go through `finalize_plan`, approved by the user (D121). Check `system/init` tools for ClaudeDesign and degrade clearly if absent (D119). Webview mode keeps the canvas chat as the thread (D120).
- **Acceptance criteria:**
  - [x] While the lead agent is mid-turn in Implementing, the user can send design messages and get replies, and the agent's output keeps streaming. (proven with fakes: `thread.test.ts` runs the thread beside a mid-turn lead session, e2e `design-thread.spec.ts` uses the fake `claude`; ClaudeDesign tool names and `finalize_plan` still need a real-account check after the AL-190 spike)
  - [x] The design thread is available in every stage, including during Planning.
  - [x] Design thread history survives tab switches and app restarts.

#### AL-197 · Approve & ship design at any time (R11)
- **Design:** R11, §7 ("send selected artboards to the agent as a spec"), artboard 4 · **Depends on:** AL-195, AL-198, AL-100
- **Scope:** "Approve & ship N artboards to agent →" is enabled in every stage whenever at least one artboard is selected. It:
  1. Snapshots a **DesignSpec vN**: artboards (name, size, structure/source), design-tokens reference (`agent-lanes-tokens.css` / the project's design system), the user's note, approved by + time, source canvas URL. Stored in the ticket's app-data folder (Decision D8).
  2. Delivers it to the ticket's lead agent **immediately**: an `SDKUserMessage` with `priority: 'now'` (Decision D11), so a running turn picks it up at its next tool boundary and an idle session starts a turn. The message carries a short summary and tells the agent to call `agent_lanes.get_design_spec` (Decision D16).
  3. Works in every stage: in Planning the plan takes the spec into account; in Implementing the agent adjusts course; in Code review / QA it becomes a review criterion.
  4. Never needs a stage gate and never interrupts a gate the user is deciding.
  5. If the session is queued, paused or lost, the spec is held and delivered first when it runs.
- **Scope update (AL-190 spike):** The DesignSpec artboard source is ClaudeDesign `read_file` output (plus a `render_preview` image), captured at ship time and stored per D8. Optionally include the relevant design chat via `get_conversation`.
- **Acceptance criteria:**
  - [ ] Shipping during Implementing reaches the running agent without a restart, and its next output references the spec version. (open: delivery to the same running session with priority `now` and no second launch is proven with the fake SDK; that a real agent's next output names the version needs a manual check against a real Claude session)
  - [ ] Shipping during Planning changes the plan the user is asked to approve. (open: the hand-off message and stage protocol tell the agent to fold the spec into the plan; whether the plan changes needs a real agent)
  - [x] Shipping twice creates v1 and v2; the agent is told v2 supersedes v1.
  - [x] Ship is visible in the Output stream ("14:01 · Design v2 approved by Kyle · 2 artboards").

#### AL-198 · Agent-side design tools
- **Design:** R11, artboard 4 ("Agent is watching this canvas", "Used · 14:01") · **Depends on:** AL-103
- **Scope:** Add to the `agent_lanes` MCP server: `get_design_spec({ version? })` → full spec (latest by default); `list_design_specs()`; `ack_design_spec({ version, note })` → marks it "Used" with time and raises `design:spec`. The stage protocol text tells the agent to fetch and acknowledge shipped specs. Sub-agents (e.g. razor-writer) can call `get_design_spec` too.
- **Acceptance criteria:**
  - [x] "Attached to this ticket" shows "Used · 14:01" after the agent acknowledges.
  - [x] "Agent is watching this canvas" shows while a spec is fetched but not yet acknowledged.

#### AL-199 · Design specs attached to the ticket
- **Design:** artboard 4 "Attached to this ticket" · **Depends on:** AL-197
- **Scope:** List of shipped specs and attachments (artboards with status Sent / Used / Superseded, the design-system file chip), view a spec, re-ship a previous version, diff two versions' artboard lists.
- **Acceptance criteria:**
  - [x] List survives restarts and reflects acknowledgements live.

#### AL-200 · Design presence on card and drill-in
- **Depends on:** AL-197, AL-144
- **Scope:** Small "Design v2" indicator on the card when a spec is attached (amber "Design v3 not yet used" while unacknowledged); design events in the live dock and Output stream; "Claude Design ↗" tab badge when the design thread has unread replies.
- **Acceptance criteria:**
  - [x] The user can see from the board which tickets have an unacknowledged design. (e2e `design-presence.spec.ts`; `AgentTicketCard.test.tsx`)

---

### E12 — Resilience and performance

#### AL-210 · Error boundaries
- **Design:** §12 Error handling · **Depends on:** AL-140
- **Scope:** Boundaries around the app root, each page, each lane, the output panel, the sub-agent panel and the design view host; fallback shows what failed and a Retry; errors go to the log (AL-214).
- **Acceptance criteria:**
  - [ ] A thrown error in one card's render leaves the rest of the board working. (open: proven in `shared/ui/error-boundary/boundaries.test.tsx` on stand-in lanes and cards; tick once AL-143 wraps each lane in `LaneErrorBoundary` and AL-144 each card in `TicketErrorBoundary`. AL-175/AL-177/AL-192 still place `PanelErrorBoundary` around the output, sub-agents and design view panels.)

#### AL-211 · Error recovery actions
- **Design:** §12 ("Each code has a defined recovery in the UI") · **Depends on:** AL-030, AL-046
- **Scope:** Central map from error code to action: `ADO_UNAUTHORIZED` / `ADO_SCOPE_MISSING` → open Connections on that row; `SESSION_LOST` → Reconnect; `BUILD_FAILED` → open Build log; `MERGE_CONFLICT` → conflict view; `GIT_DIRTY` → Diff tab on uncommitted changes; `VALIDATION` / `INTERNAL` → details + copy diagnostics.
- **Acceptance criteria:**
  - [x] Every code has a tested action.

#### AL-212 · Performance pass
- **Design:** §12 Performance · **Depends on:** AL-143, AL-175
- **Scope:** Profile the board with 8 streaming tickets and 3 builds; split the renderer bundle (1.09 MB single chunk on 2026-10-07) by page; verify rAF batching, selector isolation, lazy design tab; manual memo only where the profiler shows a hot spot.
- **Acceptance criteria:**
  - [ ] Board stays ≥ 50 fps with 8 streaming tickets; input latency < 100 ms. (open: input latency is met, 1.6–3.7 ms asserted in e2e `performance.spec.ts`, and the median frame is about 56 fps with no renderer long tasks; but 250–900 ms stalls in the GPU process's `DXGISwapChainImageBacking::Present` pull the average to 29–43 fps on this loaded machine. Re-measure on an unloaded machine; if they persist, find why each activity update repaints the full 1440×960 window)
  - [x] Initial renderer chunk < 500 kB. (215 kB after minifying and splitting vendor chunks; asserted in `performance.spec.ts`)

#### AL-213 · App lifecycle
- **Design:** §10 ("Closing the app stops every run it started") · **Depends on:** AL-100, AL-134
- **Scope:** On quit: stop runs and builds, close sessions gracefully (records flushed, sessions resumable), destroy design views; restore window size/position; warn on quit while agents are mid-turn.
- **Acceptance criteria:**
  - [x] No orphan `claude`, `dotnet` or `node` processes after quit. (checked with fakes: `closeAll` and session disposal unit tests, run-job e2e for node, build queue disposal for dotnet)

#### AL-214 · Logging and diagnostics
- **Depends on:** AL-040
- **Scope:** Rotating main-process log in app data; redaction of tokens, auth headers and env values; "Copy diagnostics" (versions, settings without secrets, recent errors) from the error fallback.
- **Acceptance criteria:**
  - [x] A test seeds a PAT and asserts it never appears in the log file.

---

### E13 — Quality and release

#### AL-220 · Feature integration tests
- **Design:** §12 Testing (integration row) · **Depends on:** ongoing
- **Scope:** Vitest + fake bridge + MSW for each feature: create ticket, change model, merge branches, build/run, connections, ship design. Written with each feature ticket; this ticket tracks gaps.
- **Acceptance criteria:**
  - [x] Every feature slice has an integration test. (all 14 slices, plus the team-board and backlog-popout widgets; ado-organisations, claude-sign-in, mcp-servers and resolve-gate got slice-level tests, and `pages/board/ui/TeamBoardLaunch.test.tsx` drives a real drop → `agent:launchFromAdo` → Undo on the board page)

#### AL-221 · Main-process test kit
- **Design:** §12 Testing (main process row) · **Depends on:** AL-080, AL-100
- **Scope:** Temp git repo factory (with origin remote); fake Agent SDK `query()` that replays scripted `SDKMessage` streams and records input/control calls (`setModel`, `applyFlagSettings`, `interrupt`, pushed user messages with priority); fake `safeStorage`.
- **Acceptance criteria:**
  - [x] Session manager, worktree/merge service, build queue and secret store have tests on this kit.

#### AL-222 · E2E golden path
- **Design:** §12 Testing (e2e row) · **Depends on:** AL-221, AL-047, AL-165, AL-171, AL-174
- **Scope:** Playwright: first run → connect (MSW-backed ADO, fake Claude) → pick temp repo → create ticket → approve plan → ship a design during Implementing (R11) → merge. Main swaps in fakes behind a test-only env flag that production builds strip.
- **Acceptance criteria:**
  - [ ] Runs in CI in under 5 minutes. (open: not yet run in CI; locally the spec takes about 13 s and the whole e2e suite 3.7–3.9 min, and the spec asserts its own 5-minute limit)

#### AL-223 · Visual QA against the artboards
- **Depends on:** E8–E11, AL-234, AL-239 (artboards 08–12 too)
- **Scope:** Capture each screen and state at 1440 × 960 and compare side by side with `docs/design/screens/*`; log differences as tickets or Decisions.
- **Acceptance criteria:**
  - [ ] All seven artboards reviewed and signed off. (open: `e2e/visual-qa.spec.ts` captures all twelve artboards (01–12) at 1440 × 960 and each was compared with `docs/design/screens`; structure and placement match, the differences are listed in the Change log for batch 9; sign-off is Kyle's)

#### AL-224 · Release build and signing
- **Depends on:** AL-007 · **Blocked by:** Q7
- **Scope:** Code-signing certificate in CI secrets, signed installer, version bump script, release notes.
- **Acceptance criteria:**
  - [ ] SmartScreen shows the publisher name on install.

#### AL-225 · User guide
- **Depends on:** AL-047
- **Scope:** `README.md`: what it is, install, first run, PAT scopes, Claude login vs API key, MCP servers, troubleshooting.
- **Acceptance criteria:**
  - [ ] A teammate installs and launches a first agent using only the guide. (open: the guide in README.md covers install, first run, PAT scopes, Claude sign-in, MCP and troubleshooting; nobody has yet followed it end to end on a clean machine with a real Azure DevOps org and Claude account)

#### AL-226 · Register in the ai-tools index
- **Blocked by:** Q8
- **Scope:** Per the company check-before-building process: shared applications live in `tools/<name>/` in the `ai-tools` repo (Tools project) with an owner line and an index row. Decide with the owner of `ticket-tracker` (Kyle) whether Agent Lanes replaces it.
- **Acceptance criteria:**
  - [ ] Index row added, or a recorded decision to keep it separate.

---

### E14 — Team board and drag-to-agent (add-on brief, `docs/design/DESIGN-team-board.md`)

Requirements T1–T9 from the 2026-10-08 add-on brief. The team's Azure DevOps board sits under the
agent lanes; dragging a card onto a lane starts the right agent. **Only one drop changes ADO:** a To
Do or Failed item dropped on Planning or Implementing is assigned to you and moved to In Progress
(T5, T9). Artboards 08–12.

#### AL-230 · Drop rules (`allowedLanes`)
- **Design:** TB§3, TB§6 · **Depends on:** AL-141
- **Scope:** Pure, zod-free `allowedLanes(card, me) → Partial<Record<Lane, DropAction>>` in `packages/contracts`, so the renderer's drag highlighting, the keyboard "Send to lane" menu and the main-process recheck run the same code; re-exported from `entities/agent-ticket` as `drop-rules`. Card kinds: board item (column, assignee, has agent, linked PR, branch), backlog item, open PR (author, unresolved threads). Each action carries its label ("start agentic review", "answer 4 comments"), whether it changes ADO, the worktree source (main, item branch, PR source branch, read-only PR branch) and the lane's default skill · model · effort.
- **Acceptance criteria:**
  - [x] Every row of the TB§3 table is a test case, including the refusals (assigned to someone else, already has an agent, no linked PR → "No linked PR", PR with 0 threads not on Implementing, Queued and Create PR never accept).
  - [x] Open PRs can be dropped on Code review by anyone, several people at once.

#### AL-231 · ADO team board data (`ado:teamBoard`)
- **Design:** T1, TB§6 · **Depends on:** AL-065, AL-061
- **Scope:** ado-client calls for the user's teams (default = the team in the user's ADO profile; identity from the Connections token test), the team's board columns (Work › Boards API) and the items on it for a sprint, mapped to To Do, In Progress, Code Review, Testing, Failed. The board's own column names win; unknown columns are shown, not dropped. Channel `ado:teamBoard({ org, project, team, sprint })` plus the team list for the dropdown. Must work against Azure DevOps Server through the client's api-version negotiation.
- **Acceptance criteria:**
  - [x] MSW fixtures for the artboard 08 board (OSC Developers, sprint 42) round-trip through the channel.
  - [x] Each item carries id, type, title, points, column, assignee (name + initials), branch and linked PR id when present.

#### AL-232 · Active PRs with thread counts (`ado:activePrs`)
- **Design:** T1, T3, T4 · **Depends on:** AL-064, AL-065
- **Scope:** Open PRs for the team's repositories with author, reviewers, source branch, repository and unresolved comment-thread count (active threads only). Channel `ado:activePrs({ org, project, team })`.
- **Acceptance criteria:**
  - [x] Thread counts ignore resolved, closed and system threads.
  - [x] A PR in a repo that isn't registered in Agent Lanes is flagged so the drop can refuse with "Add repo" (TB§7).

#### AL-233 · Backlog data (`ado:backlog`)
- **Design:** T6, TB§5 · **Depends on:** AL-065
- **Scope:** The profile team's backlog in backlog order, grouped by parent Feature, paged; filters for type, priority, area, tags, free text (id, title, tag) and "include items already in a sprint". Channel `ado:backlog({ org, project, team, filters, page })`.
- **Acceptance criteria:**
  - [x] Artboard 11's 48-item backlog fixture pages and groups correctly.
  - [x] Filters combine (AND) and are applied server-side where WIQL allows.

#### AL-234 · Team board widget
- **Design:** T1, T7, TB§2, artboard 08 · **Depends on:** AL-230, AL-231, AL-232, AL-066, AL-143
- **Scope:** `widgets/team-board` under the agent lanes: header (org, "Team board", team dropdown "· from your ADO profile", Everyone / Me / Unassigned, hint, Backlog button with count), columns To Do, In Progress, Code Review, Testing, Failed and Active PRs with counts; cards with grip, id chip, type, title, points, avatar; a lock row with the assignee's name on others' items; an "Agent in <lane>" tag on items that have an agent; PR cards with `!id`, title, "N comments" (amber) and avatar. Queries `['ado','teamBoard',team,sprint]` and `['ado','activePrs',team]`, every 60 s and on focus.
- **Acceptance criteria:**
  - [ ] Matches artboard 08 at 1440 × 960. (open: layout and content match closely in the e2e screenshot `team-board-1440x960.png` and the gallery's Artboard 08 sheet; the pixel check is AL-223. Known gaps: Backlog stays disabled until AL-239 wires the popout, and cards in a column are ordered by id, not backlog rank, D590)
  - [x] The filter and team choice persist for the session; lock and "Agent in …" never rely on colour alone.

#### AL-235 · Drag to lane (dnd-kit + keyboard)
- **Design:** T2, TB§7 Accessibility, artboards 09 and 12 · **Depends on:** AL-230, AL-234
- **Scope:** `features/drag-to-lane` with `@dnd-kit/core`: lanes that accept the card light up with the action label and a dashed border, the rest dim; "No linked PR" on Code review when relevant. Keyboard sensor (Space picks up, arrows move between lanes, Space drops, Esc cancels) with announcements ("Over Code review: start agentic review"); Tab + Enter opens a "Send to lane" menu listing only allowed lanes. A drop calls AL-236. Optimistic query updates, invalidated when the main process confirms.
- **Acceptance criteria:**
  - [x] Dragging PR !10571 lights Implementing and Code review only (artboard 09). (unit tests and e2e `drag-to-lane.spec.ts`, pointer and keyboard; screenshot `drag-to-lane-1440x960.png`)
  - [x] Every drop is possible from the keyboard alone, and announced. (Space / arrows / Space with dnd-kit announcements; Enter opens "Send to lane", announced in a polite live region)

#### AL-236 · Launch from ADO transaction (`agent:launchFromAdo`)
- **Design:** T3–T5, T9, TB§4, TB§7 · **Depends on:** AL-230, AL-100, AL-083, AL-063, AL-111, AL-165
- **Scope:** `features/launch-from-ado` plus the main handler for `agent:launchFromAdo({ source, lane, overrides? })`: re-fetch the card and re-run `allowedLanes` (refuse with "Moved to Testing — refreshed" etc.); for a To Do or Failed item on Planning/Implementing only, assign to the signed-in identity and move to In Progress; create the worktree (from main, the item's branch, or the PR's source branch; read-only for reviews); create the ticket and start the session with the lane's default skill, model, effort and gates (Planning keeps the plan gate, Implementing skips it; QA runs /cs-qa-wip on Sonnet Med); queue when over the concurrency cap. A failing step rolls back the earlier ones. Returns the ticket id and an undo token. A missing scope is refused by name with "Open Connections".
- **Acceptance criteria:**
  - [x] No other drop ever writes to ADO (a test asserts zero ADO write calls for every other TB§3 row). (`launch-from-ado.test.ts`)
  - [x] A failure after the ADO update restores the item's assignee and state. (worktree and session failures both restore #71335)
  - [x] A PR from an unregistered repo is refused with an "Add repo" action.

#### AL-237 · Undo a launch (`agent:undoLaunch`)
- **Design:** T8, TB§4, artboard 10 · **Depends on:** AL-236, AL-030
- **Scope:** A success toast (polite live region) saying what changed ("#71318 assigned to you and moved to In Progress · agent started in Planning") with a real Undo button for 10 s or until the agent's first turn ends. `agent:undoLaunch(token)` reverts the assignment and state, removes the worktree and ends the session. Not offered once the agent has pushed or a review agent has posted comments; the toast then says what to revert by hand.
- **Acceptance criteria:**
  - [x] Undo within 10 s leaves ADO and disk exactly as before the drop. (`undo-launch.test.ts` with real git, the real worktree service and ticket store, and the fake ADO org)
  - [x] Undo is reachable by keyboard for the full 10 s. (`app/toasts/launch-undo.test.tsx`; the full drop-and-Undo flow in the real app is AL-241)

#### AL-238 · PR launches: review and answer comments
- **Design:** T3, T4, TB§3 · **Depends on:** AL-236, AL-232
- **Scope:** `features/answer-pr-comments` and the review path. Code review drop → read-only worktree on the PR's source branch; the first turn runs /code-review and posts through /pr-comment-actioner (Opus High); several reviewers may review one PR at once. Implementing drop by the PR's author → worktree on the source branch; the first turn carries the open threads and runs /pr-comment-actioner (Sonnet High), which replies, resolves and pushes. The app itself changes no ADO state or assignment.
- **Acceptance criteria:**
  - [x] Two users can start reviews of the same PR at once without sharing a worktree. (`ticket-worktree.test.ts` with real git: `pr-10598-review` and `pr-10598-review-2`)
  - [x] The first turn lists every unresolved thread with its file and line. (`launch-from-ado.test.ts`: all 6 open threads of !10571)

#### AL-239 · Backlog popout
- **Design:** T6, TB§5, artboards 11 and 12 · **Depends on:** AL-233, AL-235, AL-236, AL-029
- **Scope:** `widgets/backlog-popout`: modal over the lower board with search, type segmented control, priority/area/tag filters and the "in a sprint" toggle; rows grouped by Feature with grip, checkbox, id, type pill, title, tag, points and priority; shift-click multi-select (one agent per item, extras Queued); while dragging, the modal fades to 35 % and lets the pointer through; rows keep an "Agent in Planning" tag after a drop; Esc, close or an outside click closes it; search and filters are remembered for the session. Pop out moves it to its own window, with native HTML5 drag back to the main window.
- **Acceptance criteria:**
  - [ ] Matches artboards 11 and 12. (open: close in `backlog-popout-1440x960.png` and `backlog-dragging-1440x960.png`, with deliberate differences D735–D736; sign-off at AL-223. Dragging from the popped-out window to the main window was checked only with synthetic DragEvents; a real mouse drag across two monitors needs a manual try)
  - [x] Dragging two selected rows onto Planning starts two agents (or queues the second at the cap). (`e2e/backlog-popout.spec.ts` with the repo limit at 1: #71360 runs in Planning, #71362 is Queued, both assigned and Active in the fake org; `use-drop.test.tsx`)

#### AL-240 · Per-lane drop defaults and Alt launch sheet
- **Design:** TB§3 · **Depends on:** AL-146, AL-236
- **Scope:** A "Drops" section in Settings with each lane's default skill(s), model and effort (seeded from TB§3). Holding Alt while dropping opens a launch sheet (skills, model, effort, gates) before anything changes.
- **Acceptance criteria:**
  - [x] Cancelling the Alt sheet changes nothing in ADO or on disk. (`LaunchSheet.test.tsx`: Cancel resolves null and `agent:launchFromAdo` is never invoked)

#### AL-241 · E2E: team board drops
- **Design:** E14 · **Depends on:** AL-237, AL-238, AL-239, AL-240
- **Scope:** Playwright against fake ADO and a fake Agent SDK: Failed item → Planning (assign, In Progress, Undo), PR → Code review (no ADO writes), own PR → Implementing, backlog multi-drag, a drop refused by the recheck, and a keyboard-only drop.
- **Acceptance criteria:**
  - [ ] All six flows pass in CI. (open: `e2e/team-board-drops.spec.ts` passes 6/6 locally and in the full suite on main; not yet run in CI)

---

#### AL-242 · Board picker for the team board
- **Design:** T1, TB§2 (Kyle, 2026-10-08: "options to select my team, my team board and team sprint") · **Depends on:** AL-234
- **Scope:** A Board menu next to Team in the board header listing the team's ADO boards (its backlog levels: Stories or Backlog items, Features, Epics). The choice is kept in the UI prefs per team and drives the team board widget's columns and items. Main: `ado:listBoards({ org, project, team })` over the team's Work › Boards API, and a `board` field on `ado:teamBoard`. Must work on Azure DevOps Server through api-version negotiation.
- **Acceptance criteria:**
  - [ ] The team board shows the chosen board's columns, and the choice survives a restart.
  - [ ] Switching team falls back to that team's first board when the saved one is not there.

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
| D13 | Small typed in-app router (three routes) instead of React Navigation | Three routes, desktop only; avoids a navigation stack built for mobile. Revisit with Q3. Implemented by AL-140 (D159–D167) | 2026-10-07 |
| D14 | The web entry imports `AppRegistry` from react-native-web, typed by a local `.d.ts` | RN's types model native `RootTag`; `@types/react-native-web` exports interfaces only | 2026-10-07 |
| D15 | App ID `au.com.companionsystems.agentlanes`; NSIS per-user installer; Windows x64 first | Team platform | 2026-10-07 |
| D16 | Design hand-off sends a short user turn and the agent pulls the full spec with `agent_lanes.get_design_spec`, then calls `ack_design_spec` | Keeps large artboard payloads out of the prompt and gives the UI an acknowledgement for "Used · 14:01" | 2026-10-07 |
| D17 | CI runs on GitHub Actions (answers Q6) | The repo now lives at github.com/KyleRichards94/ClaudeLanes | 2026-10-07 |
| D18 | Headless permission policy for the first build: `acceptEdits`, plus a Bash allow-list of git read commands and the repo's detected build and test commands; anything else asks through `canUseTool` ("Needs you · permission"). Editable in settings (provisional answer to Q9) | Lets AL-109 proceed; the user can tighten or loosen it later | 2026-10-07 |
| D19 | IPC channels and main-process handlers are split per domain (`contracts/src/domains/*`, `src/main/<domain>/handlers.ts`, composition root `src/main/services.ts`) | ~110 parallel branches would otherwise collide on two files | 2026-10-07 |
| D20 | AL-040: `SecretStore` API is async: `put` → `SecretMetadata`, `get` → `string \| undefined`, `delete` → `boolean`, `list` → `{id, createdAt, updatedAt}[]`, plus `status()` → `{encryptionAvailable, issues}` | The store needs a way to report a corrupt file or undecryptable entry so a later ticket can prompt a reconnect | 2026-10-07 |
| D21 | AL-040: `put`/`delete` throw a typed `SecretStoreError` (ENCRYPTION_UNAVAILABLE, ENCRYPTION_FAILED, INVALID_ID, INVALID_SECRET, STORE_UNREADABLE, WRITE_FAILED) whose message never contains the secret; `get`/`list`/`status` never throw | contracts' `ErrorCode` has no secrets code; the caller maps the error to a `Result` | 2026-10-07 |
| D22 | AL-040: The Linux `basic_text` safeStorage backend counts as unavailable, like `isEncryptionAvailable() === false` | It uses a hard-coded key, which amounts to a plaintext fallback | 2026-10-07 |
| D23 | AL-040: `secrets.json` format is `{version: 1, secrets: {<id>: {ciphertext (base64), createdAt, updatedAt}}}`; ids match `/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/` (e.g. `ado:contoso`, `claude:api-key`); secrets are capped at 64 KiB | Blocks `__proto__` and path tricks; bounded input | 2026-10-07 |
| D24 | AL-040: A corrupt or newer-version file is renamed to `secrets.corrupt-<timestamp>.json` and the store starts empty; malformed entries are dropped one by one; a file unreadable for an I/O reason is left alone and writes are refused (STORE_UNREADABLE) | A temporary lock must not wipe the other secrets | 2026-10-07 |
| D25 | AL-040: Writes go one at a time through a queue and are atomic (write + fsync a temp file, rename with EPERM/EBUSY/EACCES retry on Windows, mode 0o600); memory changes only after the write succeeds | No torn or half-applied files | 2026-10-07 |
| D26 | AL-040: Secrets are decrypted on every `get()`, no plaintext is cached, `list()` never decrypts; the store reads the file when created, so corruption is moved aside and reported at start-up | Shortest plaintext lifetime; start-up gets the issue list | 2026-10-07 |
| D27 | AL-040: `services.ts` uses Electron's `safeStorage` by default with an optional `ServiceOptions.safeStorage`; a reusable AES-GCM fake (`createFakeSafeStorage`) lives in `src/main/secrets/testing` | Other tickets' tests can encrypt for real without Electron | 2026-10-07 |
| D28 | AL-040: The no-secret contract test checks output-side JSON Schema (`z.toJSONSchema`) of every invoke response and event payload; fields showing part of a token must start with `masked` (e.g. `maskedToken`), other false positives go in `SAFE_FIELD_NAMES` with a reason, plural `tokens` (LLM counts) is allowed, request schemas are not checked | Save requests legitimately carry the token | 2026-10-07 |
| D29 | AL-028: New `tone` token group (border, wash, band, text, fill for claude, ado, attention, danger, ok) plus `progressGradient` and `mutedOpacity` = 0.75 in `packages/tokens/src/tones.ts`, with a matching `:root` block in `agent-lanes-tokens.css`; values sampled from artboard 6 (e.g. attention border #FCD34D / band #FEF3C7 / text #92400E; danger #FECACA / #FEE2E2 / #991B1B, fill #F87171; ok band #D1FAE5, text #047857, fill #10B981; selected border #8B80E0) | §11 has no tints; CLAUDE.md puts values in packages/tokens | 2026-10-07 |
| D30 | AL-028: `tones.ts` repeats the hex values it shares with `color` instead of importing them; `tones.test.ts` checks they still equal `color` and the CSS variables, and that each band text meets 4.5:1 on its band | `index.ts` re-exports `tones.ts`, so importing back would be circular | 2026-10-07 |
| D31 | AL-028: Added `CardSection` (tone claude/ado/danger/ok, 14 px side inset) beyond the ticket scope | Every card on artboards 1 and 6 has a tinted activity area under a white header; AL-144 needs it | 2026-10-07 |
| D32 | AL-028: The muted (merged) card is opacity 0.75 over the whole card, text included, with the default line border | Matches artboard 6 (about 0.76 measured); AL-033 decides whether this inactive content is exempt from contrast | 2026-10-07 |
| D33 | AL-028: `ProgressBar` tones are gradient (violet to sky), `ado` (#38BDF8), `danger` (#F87171) and green; `progress` is 0 to 1, clamped (NaN/Infinity count as 0); `label` is required for the accessible name | Artboard 6 shows PR-open and build-failed fills; axe flags `aria-progressbar-name` without a name | 2026-10-07 |
| D34 | AL-028: The gradient uses RN 0.87's typed `backgroundImage` string over a solid violet `backgroundColor`, no `*.web.tsx` | react-native-web passes it through to CSS | 2026-10-07 |
| D35 | AL-028: Card's footer band renders a string label with React Native `Text` (bold 12 px, tone text colour) until AL-023's Text primitives land | AL-023 not merged yet | 2026-10-07 |
| D36 | AL-012: Event `at` is epoch milliseconds (`Date.now()`), defaulted by `emit` when the caller omits it | Cheap to stamp and validate on high-rate channels such as `agent:output`; the UI formats it | 2026-10-07 |
| D37 | AL-012: Shared envelopes in `packages/contracts/src/events.ts`: `EventEnvelopeSchema` `{ at }` and `TicketEventEnvelopeSchema` `{ ticketId, at }` (`TicketIdSchema` is a non-empty string for now); `toast` and `connections:changed` use `{ at }`, the other eight channels `{ ticketId, at }` | One definition for all domains; AL-082/AL-101 tighten `TicketIdSchema` | 2026-10-07 |
| D38 | AL-012: Payloads are envelope-only except `toast` (tone info/success/warning/error, title, optional body); placement: `agent:*` in agent, `build:log` and `run:status` in build, `connections:changed` in connections, `design:spec` in design, `toast` in app | Owning tickets extend the envelopes; main can raise a usable toast now (AL-030 adds actions) | 2026-10-07 |
| D39 | AL-012: `emit` sends the zod-parsed copy, so undeclared fields are stripped; logs carry zod issue paths and messages, never rejected values | Enforces "events carry no secrets" in dev and production | 2026-10-07 |
| D40 | AL-012: Strict mode (throw on invalid payload) is `!app.isPackaged`, so dev, start and e2e throw; only the installed app logs and drops | Contract bugs surface everywhere except for end users | 2026-10-07 |
| D41 | AL-012: Events go to `mainWindow.webContents.mainFrame` only while its URL passes `isTrustedSenderUrl`; no window or a loading page drops quietly, any other URL is refused and logged | Same trust rule as invoke; renderers backfill over invoke (AL-102) | 2026-10-07 |
| D42 | AL-012: Services get `emit` through `ServiceOptions`/`Services` (`services.emit`), never a window reference; `EventInput<C>` (z.input) added next to `EventPayload<C>` for emit's argument | Keeps services free of window state | 2026-10-07 |
| D43 | AL-012: Renderer `subscribe(channel, listener)` in `@/shared/api` validates each payload and logs and drops invalid ones; `installFakeBridge` returns a `FakeBridge` with `emit` and `listenerCount` (its `on` throws for unknown channels; replies optional) | AL-015's EventHub builds on `subscribe`; tests push events through the fake | 2026-10-07 |
| D44 | AL-012: Vitest's `main` project also includes `apps/desktop/src/preload/**/*.test.ts`; the e2e sends via `webContents.mainFrame.send` from Playwright rather than through `emit` | Unit-tests the preload bridge with a mocked electron; no test-only hook in production code | 2026-10-07 |
| D45 | AL-008: CI runs typecheck, lint, lint probes, test, build and e2e as separate named steps (not one `pnpm verify`) on `windows-latest`, Node 24, no xvfb | A red run names the failing check; the app ships for Windows and hosted Windows runners have a desktop session | 2026-10-07 |
| D46 | AL-008: Triggers are `pull_request`, push to `main` and `feature/**`, and `workflow_dispatch`; concurrency cancels superseded runs except on `main` | §7 merges without PRs, so a branch push is the only pre-merge check; every integration merge gets its own result | 2026-10-07 |
| D47 | AL-008: `scripts/lint-probes.mjs` (`pnpm lint:probes`) checks that each layer/process rule and Steiger's forbidden-imports still fail lint, with a passing control per rule; probes lint from stdin or a temp FSD tree and never write to `src/` | Tests acceptance criterion 2 on every run; mutation-tested | 2026-10-07 |
| D48 | AL-008: Electron binary fetched with `node node_modules/electron/install.js` and cached from @electron/get's default folder keyed on the Electron version; pnpm store cached via `pnpm/action-setup` `cache: true`; third-party `pnpm/action-setup` pinned to a SHA (v6.1.0), first-party actions on major tags; `test-results/` uploaded as `e2e-results` for 14 days; `contents: read`, 30-minute timeout | Electron 44 has no postinstall; supply-chain hygiene; failure evidence | 2026-10-07 |
| D49 | AL-031: Icons are named for meaning (build = hammer, stop = square, close = X, alert = circle-alert, refresh = rotate-cw, branch, merge), plus arrow-up-right and chevron-up/left/right beyond the ticket list; play/stop/pause are filled, the rest lucide 2 px stroke | A glyph can change without touching callers; artboards 3 and 4 use the up-right arrow and solid Run/Stop | 2026-10-07 |
| D50 | AL-031: Icon colour and size resolve explicit prop, then nearest `IconProvider`, then surrounding text (`currentColor`/`1em` on web, 16 px native fallback); decorative unless given a `label` (then role img) | Icons inside Button/Pill/Tabs/Toast labels match their text | 2026-10-07 |
| D51 | AL-031: Glyphs come from `lucide-react-native` (per-icon imports) on `react-native-svg` 15.15.5; `@react-native/assets-registry/registry` is aliased to react-native-web's AssetRegistry in electron-vite and Vitest; Vitest's ui project aliases `react-native-svg` to its ESM build and inlines both packages | RN 0.87 no longer installs the asset registry; Vitest otherwise loads the native CommonJS build | 2026-10-07 |
| D52 | AL-021: CSP is `font-src 'self'` (no `data:`); `assetsInlineLimit` keeps .woff/.woff2 as emitted files | Small subset files would otherwise be inlined as data: URIs the CSP blocks | 2026-10-07 |
| D53 | AL-021: Fonts load through `app/styles/fonts.css` (one import in `main.tsx`) using the full per-weight @fontsource CSS with every subset (unicode-range loads only what is used); Plus Jakarta Sans 400 is not bundled (CSS falls back to 500) | Accented names render in brand fonts; one shared-file line | 2026-10-07 |
| D54 | AL-021: OFL texts are committed copies in `apps/desktop/licenses/fonts/`, shipped by electron-builder `extraFiles` to `<install dir>/licenses/`; an e2e test fails if they drift from the installed package or a new @fontsource dependency has no licence file | Licence notices without a package-time copy step | 2026-10-07 |
| D55 | AL-021: "Network disabled" in e2e means session offline emulation plus a webRequest hook that cancels and records any http(s)/ws(s) request; the drawn face is checked with CDP `CSS.getPlatformFontsForNode`; the mono check uses the runtime-info line plus an injected id/branch sample until AL-025/AL-144 land | Proves the face Chromium drew, not just the CSS declaration | 2026-10-07 |
| D56 | AL-041: electron-store only stores the whole document as one file with atomic writes; versioning, zod validation and migrations live in the main-process `SettingsService` (`apps/desktop/src/main/settings/`) | electron-store's migrations are keyed on the app's semver and its validation is JSON Schema, not zod | 2026-10-07 |
| D57 | AL-041: electron-store is bundled into the CommonJS main build (`esmOnlyMainDeps` in `apps/desktop/electron.vite.config.ts`) | It is ESM-only; an externalised `require()` returned the module namespace rather than the class | 2026-10-07 |
| D58 | AL-041: Settings v1 is the flat, prefs-only shape from design §6 (gates as a `gatedStages` list); the v1→v2 migration also registers v1's `lastRepo` as a repo | No release wrote v1; it exists so the migration is real and tested | 2026-10-07 |
| D59 | AL-041: The loader recovers field by field: an invalid value reverts to its default with a warning, corrupt JSON falls back to defaults, a newer version is read as current without being written back, a new field takes its default without a version bump | A bad field never loses the rest of the user's settings | 2026-10-07 |
| D60 | AL-041: Settings zod schemas have no `.default()`; defaults are functions in contracts (`defaultSettings`, `defaultUiPrefs`, …) | zod 4 applies defaults inside `.partial()`, which would make every patch overwrite stored values | 2026-10-07 |
| D61 | AL-041: Added `packages/contracts/src/vocabulary.ts` with `STAGES`, `LANES`, `MODELS`, `EFFORTS`, `GATES`, `EMBED_MODES` in kebab-case (`code-review`, `create-pr`, `mcp-link`) | Settings needs them now; ticket, agent and board domains reuse them | 2026-10-07 |
| D62 | AL-041: Defaults: Opus with XHigh effort, Planning and Create PR gated, build queue 2, 3 agents per repo, Done lane collapsed, embed mode webview, worktree root `<repo>/../.agent-lanes`, base branch `main` | Artboards 1–2, design §9/§10, Q5 | 2026-10-07 |
| D63 | AL-041: Repos are identified by absolute path (no separate id); `ui.lastRepo` holds that path, `ui.lastSprint` one ADO iteration id; build/run overrides are `buildCommand`/`runCommand`, `null` meaning use the detected command | Simplest stable key; one sprint selection app-wide | 2026-10-07 |
| D64 | AL-041: `settings:update` semantics: a top-level section replaces the stored one; inside `defaults` and `ui` each named field replaces that field; arrays and records are replaced whole; undefined fields are ignored; unknown keys are refused | Predictable partial updates with a strict zod patch | 2026-10-07 |
| D65 | AL-041: `settings:update` from the renderer can edit, reorder or remove repos but cannot add a new repo path (returns `VALIDATION`); main services add repos through `SettingsService.update` | Keeps design §8's "repo paths are picked with a native folder dialog" | 2026-10-07 |
| D66 | AL-041: The UI prefs Zustand store (`useUiPrefs`) lives in a new `shared/model` segment, not an entity slice | App-wide UI state used by pages and features; Steiger flags a slice nothing references yet | 2026-10-07 |
| D67 | AL-041: The persist store uses `skipHydration`; an app-level `UiPrefsGate` (in `AppProviders`) holds the first render until prefs load, rendering on defaults if loading fails; the storage adapter never rejects | Lanes don't flash their default state | 2026-10-07 |
| D68 | AL-041: electron-store's own `electron-store-get-data` ipcMain listener (userData path, app version) is left registered | The renderer cannot reach it: the preload exposes only allow-listed `invoke`/`on` | 2026-10-07 |
| D69 | AL-041: Test helpers `installFakeSettings` (renderer `shared/testing`, a stateful fake main process for settings) and `createMemorySettingsFile` (`main/settings/settings-file.ts`) | Shared fakes for later settings consumers | 2026-10-07 |
| D70 | AL-041: No `settings:changed` event yet; `useUpdateSettings` updates its query cache from the `settings:update` reply | AL-012 was not merged when the ticket was built; a follow-up can add the event | 2026-10-07 |
| D71 | AL-060: `createAdoClient` returns `Result<AdoClient>` (`VALIDATION` for a bad org URL, PAT or options) instead of throwing; messages never echo the URL or PAT | The factory also meets "every exported call returns `Result<T>`" | 2026-10-07 |
| D72 | AL-060: No new error codes: non-auth HTTP failure, timeout, network error, cancel, exhausted 429/503 retries and paging loops → `INTERNAL`; 400, non-JSON 2xx and schema mismatch → `VALIDATION`; `Err.details` is a typed `AdoErrorDetails` (`source: 'ado'`, kind, status, method, url, attempts, activityId, adoMessage, adoTypeKey, retryAfterMs, issues) read with `isAdoErrorDetails()` | Callers branch on `details.kind` without widening the contracts error enum | 2026-10-07 |
| D73 | AL-060: Every request sends `X-TFS-FedAuthRedirect: Suppress`; a 203 or a 2xx HTML body still maps to `ADO_SCOPE_MISSING` | ADO answers a bad token with 401 rather than a sign-in redirect | 2026-10-07 |
| D74 | AL-060: Retry: 3 retries, 1/2/4 s backoff without `Retry-After`; a `Retry-After` above `maxDelayMs` (30 s) ends the call at once with a `throttled` error; POSTs are retried too | A 429/503 means ADO did not process the request; never block a call for minutes | 2026-10-07 |
| D75 | AL-060: Timeout is 30 s per attempt including the body read; a caller `AbortSignal` cancels the request and any retry wait | Bounded calls, cancellable from the UI | 2026-10-07 |
| D76 | AL-060: Org URLs must be https (http only for loopback) with no credentials; relative paths may not climb out of the org (even with encoded `..`); absolute URLs only to the org's origin or, for cloud orgs, `*.dev.azure.com` / `*.visualstudio.com`; anything else is refused before fetch | Keeps the PAT on the right hosts | 2026-10-07 |
| D77 | AL-060: `list()` follows the `x-ms-continuationtoken` header or a `continuationToken` body field; options `itemsKey` (e.g. `comments`), `tokenParam`, `maxPages` (default 100); a failing page fails the whole call | Never returns a partial list | 2026-10-07 |
| D78 | AL-060: Redaction removes the raw PAT, its base64 forms and any `Basic …`/`Bearer …` credential from error messages, details and log entries; the optional `log` callback gets one redacted entry per attempt | PAT-leak test over 19 error scenarios (fails 15 with redaction off) | 2026-10-07 |
| D79 | AL-060: The default `fetch` is looked up on `globalThis` at call time, not at client creation | A later-installed fetch (MSW in tests, Electron `net.fetch`) is used | 2026-10-07 |
| D80 | AL-060: Also exported: `normalizeOrgUrl` (for the Connections form) and an `adoPath` tagged template that URL-encodes project/team names; `ADO_API_VERSION` and `REQUIRED_PAT_SCOPES` moved to `src/constants.ts`, re-exported unchanged | Shared helpers for AL-043 and the E4 endpoint tickets | 2026-10-07 |
| D81 | AL-060: `msw` ^3.0.2 is a devDependency of `@agent-lanes/ado-client` (msw 3's listen option is `onUnhandledFrame`); `@agent-lanes/contracts` is a dependency for `Result`; `src/testing/msw-server.ts` is test-only, not exported | AL-065 decides whether to export a `./testing` entry | 2026-10-07 |
| D82 | AL-082: The naming module is pure and lives in `apps/desktop/src/main/git/naming/` (own `index.ts`); no IPC channel, services or registration change | The ticket asks for a pure function; the IPC side needs repos (AL-081) and the git runner (AL-080) | 2026-10-07 |
| D83 | AL-082: The 32-character limit covers the whole `<id>-<slug>`; a dedupe suffix stays within 32 by dropping words (`71330-asset-register-paging-2`) | Only reading that gives the artboard's `71273-cutover-frmjobcontrol-to` from "Cutover frmJobControl to Blazor" | 2026-10-07 |
| D84 | AL-082: Sub-branches `sub/<ticket-id>-<slug>`: the limit covers the part after `sub/`, and the slug keeps at least 8 characters after a long no-ticket id | The agent name never disappears | 2026-10-07 |
| D85 | AL-082: Collision checks ignore case and catch path clashes (`a` vs `a/b`); callers pass local branches plus remote branches with `origin/` stripped | Loose refs are files on a case-insensitive Windows file system | 2026-10-07 |
| D86 | AL-082: `nameSubAgent` throws `BranchNamingError` (`PARENT_BRANCH_EXISTS`) when the repo has a branch named `sub` | No suffix can work around it | 2026-10-07 |
| D87 | AL-082: Slugging: NFKD with accent marks removed, a few letters transliterated (ß→ss, æ→ae, ø→o, ł→l, ı→i), apostrophes dropped (don't→dont), other non-ASCII (CJK, Cyrillic, emoji) is a word separator, camelCase stays one word | Matches the design's `frmjobcontrol` | 2026-10-07 |
| D88 | AL-082: A title with no usable ASCII words slugs to `untitled` (tickets) or `agent` (sub-agents), e.g. `71273-untitled` | Avoids an all-digit branch name git could read as a commit SHA | 2026-10-07 |
| D89 | AL-082: The no-ticket date uses local time; a no-ticket ticket's worktree folder is its `nt-…` branch name, which is also the ticket id its sub-branches use; a work-item ticket's folder is `<id>` | Design §9 step 1 | 2026-10-07 |
| D90 | AL-082: `nameSubAgent` returns the sub-branch and its worktree folder `<ticket-id>--<slug>` (AL-084) together | Both always share the same deduped slug | 2026-10-07 |
| D91 | AL-082: `checkBranchName` (pure port of `git check-ref-format --branch`) also refuses the double quote, `<`, `>` and the pipe character, Windows device names (nul, con, com1, lpt9.txt …), a path part ending in `.`, `.lock` in any case, and a bare `@` | Windows can't create those as ref files; git reads `@` as HEAD | 2026-10-07 |
| D92 | AL-082: User-edited names are held only to the git/Windows rules and the collision check, not the lowercase 32-character convention; `validateBranchName` runs the pure check before asking git, so git never sees a name starting with `-` or containing `@{` | The ticket only asks for re-validation with check-ref-format; git's answer stays the same in any folder | 2026-10-07 |
| D93 | AL-082: `createGitCheckRefFormat` calls git through `execFile` (no shell) as a stand-in until AL-080's runner; its `CheckRefFormat` type is injectable | AL-080 swaps in a runner-based implementation | 2026-10-07 |
| D94 | AL-131: `build:queued` event (job snapshot plus `at`) on every queue transition: queued with position, position moved, running, finished, cancelled | The renderer shows and clears "Queued" from one channel | 2026-10-07 |
| D95 | AL-131: Invoke channels `build:cancel({ jobId }) → { cancelled }` and `build:listJobs() → { concurrency, jobs }` | Cancel is reachable from the UI; the renderer backfills queue state after a reload, since events drop while no window listens | 2026-10-07 |
| D96 | AL-131: Queue states are only queued / running / finished / cancelled; pass or fail belongs to AL-132's result; a `run` that throws resolves `{ status: 'error' }` with state `finished` | The queue stays generic | 2026-10-07 |
| D97 | AL-131: `BuildQueuedEventSchema` declares `ticketId` and `at` itself instead of extending `TicketEventEnvelopeSchema` | AL-012 was not on main when the ticket was built | 2026-10-07 |
| D98 | AL-131: Concurrency is a getter read at each scheduling decision, plus `refresh()`. At merge the integrator wired it to `settings.buildQueueSize` with a refresh after each successful settings update, and `createServices` emits `build:queued` for every queue event; `DEFAULT_BUILD_CONCURRENCY` (2) stays in `main/build` | AL-041 and AL-012 were already on main | 2026-10-07 |
| D99 | AL-131: A busy worktree doesn't block the line: later jobs for other worktrees start first and the waiting job keeps its FIFO place | Throughput | 2026-10-07 |
| D100 | AL-131: A cancelled running job holds its slot and worktree until its `run` settles; `dispose()` aborts everything and waits at most 5 s, called from `disposeServices` | The next job never overlaps a process still dying (AL-134 owns the tree kill); a stuck job can't block quit | 2026-10-07 |
| D101 | AL-131: Job snapshots over IPC leave out the worktree path; the ticket id identifies the job | Paths stay in main | 2026-10-07 |
| D102 | AL-007: Electron pinned to exactly 44.6.0 in `apps/desktop/package.json`; Electron upgrades now need an exact version bump | electron-builder only reads an exact version or `apps/desktop/node_modules` (empty with the hoisted layout); `pnpm package` failed with "Electron version is a range" | 2026-10-07 |
| D103 | AL-007: App icon drawn by `apps/desktop/scripts/app-icon.mts` (`pnpm --filter @agent-lanes/desktop icon`, no image libraries): rounded square with the claude→ado gradient and three white lane bars; writes `build/icon.ico` (16–256 px, BMP up to 48, PNG above) and `build/icon.png`; a test fails if the committed files differ from its output | Regenerable from the tokens | 2026-10-07 |
| D104 | AL-007: Icon bars are 2/32 thick and snap to whole pixels up to 64 px; sizes from 24 px have a 1/16 margin | The mark stays crisp at taskbar sizes | 2026-10-07 |
| D105 | AL-007: `src/main/agent/claude-executable.ts`: `resolveClaudeExecutable()` returns `resources/app.asar.unpacked/node_modules/<platform package>/claude(.exe)` when packaged and uses `require.resolve` in dev; AL-100 passes `pathToClaudeCodeExecutable: resolveClaudeExecutable(claudeExecutableLookup(app))` and errors clearly on null | The SDK's own lookup points inside app.asar, which `child_process.spawn` cannot start | 2026-10-07 |
| D106 | AL-007: `build/installer.nsh` (nsis.include) deletes the installer copy electron-builder leaves at `%LOCALAPPDATA%\@agent-lanesdesktop-updater\installer.exe` after install and on uninstall, then removes that folder if empty; remove it if an auto-updater is added | Otherwise uninstall leaves a file outside the app data folder | 2026-10-07 |
| D107 | AL-007: Packaged checks use their own Playwright config (`playwright.packaged.config.ts`, `pnpm e2e:packaged`, which runs `pnpm package` first); `pnpm e2e` ignores `e2e/packaged`; the install round trip runs only with `AGENT_LANES_INSTALL_TEST=1` | Packaging takes minutes and ~1 GB; the install creates real shortcuts and an Add/Remove Programs entry | 2026-10-07 |
| D108 | AL-007: `electron-builder.yml` adds a copyright line, explicit Start menu and desktop shortcuts, `uninstallDisplayName: Agent Lanes` and `deleteAppDataOnUninstall: false` | Uninstall keeps `%APPDATA%\Agent Lanes`; the default name appends the version | 2026-10-07 |
| D109 | AL-007: The assisted NSIS installer (oneClick false, perMachine false) still offers an "all users" mode with elevation; flagged, not changed | D15 says per-user; a per-user-only installer needs a custom NSIS install-mode override | 2026-10-07 |
| D110 | AL-007: The Vitest `main` project also runs `apps/desktop/scripts/**/*.test.ts`; `tsconfig.node.json` and the desktop lint script cover `scripts/` and the packaged Playwright config | Tests and lint for the icon script | 2026-10-07 |
| D111 | AL-190: Embed approach: one `WebContentsView` per canvas in partition `persist:claude-design`, no preload, sandboxed, context-isolated. The e2e probe shows a page sending `X-Frame-Options: DENY` and `frame-ancestors 'none'` loads in the view but fails in an iframe (ERR_BLOCKED_BY_RESPONSE) | The renderer CSP (`default-src 'self'`) would block a claude.ai iframe anyway | 2026-10-07 |
| D112 | AL-190: Cookies in `persist:claude-design` never reach the app's default session and survive an app restart after `cookies.flushStore()` | A claude.ai sign-in persists without the app storing any credential | 2026-10-07 |
| D113 | AL-190: No user-agent spoofing (the view's UA contains `AgentLanes/0.1.0 … Electron/44.6.0`), so Google sign-in is expected to be refused in the view; email and SSO sign-in must be tried by hand; on failure the tab offers MCP-link mode (AL-194) | Working around Google's embedded-browser policy is not acceptable | 2026-10-07 |
| D114 | AL-190: `window.open` popups to claude.ai and its auth hosts open as child windows in the same partition; every other popup goes to the OS browser | A sign-in finished in the OS browser never reaches the view's cookies | 2026-10-07 |
| D115 | AL-190: The Claude Design MCP surface is the Agent SDK's built-in `ClaudeDesign` tool (`{ operation, arguments }`), calling `https://api.anthropic.com/v1/design/mcp` with the user's claude.ai OAuth login (`user:design:read` / `user:design:write` scopes, one-time Design consent); API-key logins cannot reach it | Read from the installed SDK 0.3.292 (sdk-tools.d.ts and the bundled CLI); nothing was sent to claude.ai | 2026-10-07 |
| D116 | AL-190: ClaudeDesign operations in SDK 0.3.292. Read: list, list_design_systems, get_claude_design_prompt, list_projects, get_project, list_files, read_file, get_conversation, list_members. Write: render_preview, create_project, put_conversation, finalize_plan, write_files, copy_files, create_support_js, delete_files, add_member, update_member_role, remove_member, update_sharing. The server can add read-only operations, found through `list` | The live list still needs a check with a real login | 2026-10-07 |
| D117 | AL-190: No operation reads the canvas selection, lists "artboards" as such, or posts into the canvas's live chat (`get_conversation` reads a transcript, `put_conversation` writes one) | Artboard selection for hand-off is always Agent Lanes' own checklist, in both modes | 2026-10-07 |
| D118 | AL-190: Artboard read path: artboards are files in the Design project, read by a per-ticket design session (Agent SDK, small model, `tools` limited to ClaudeDesign, `outputFormat` json_schema) calling list_files, read_file and render_preview; main never calls `/v1/design` directly with Claude Code's OAuth token | The token belongs to the CLI login, the endpoint is first-party only, and the tool handles consent and write grants | 2026-10-07 |
| D119 | AL-190: ClaudeDesign availability depends on a claude.ai login, the org policy `allow_design_sync` and a server flag; the app checks for `ClaudeDesign` in the session's `system/init` tools and shows "not available for this Claude login" instead of failing | Degrades clearly | 2026-10-07 |
| D120 | AL-190: Q11 answered: both. Webview mode uses the canvas's own Claude chat in the live view; MCP-link mode, or a failed webview sign-in, uses an in-app thread backed by a per-ticket design session with the ClaudeDesign tool, separate from the lead agent's session | As proposed in Q11 | 2026-10-07 |
| D121 | AL-190: Design-session writes go through `finalize_plan` and its `plan_token`; AL-196 surfaces each plan for approval through `canUseTool` | The CLI denies `write_files` without a plan_token in non-interactive sessions | 2026-10-07 |
| D122 | AL-190: Canvas identity: a ticket stores a `DesignCanvasRef` `{ kind, id, url }` (kind `design-project` or `artifact`), built by `parseDesignCanvasUrl` from `https://claude.ai/design/p/<id>`, `https://claude.ai/artifact/<id>` or `https://claude.ai/code/artifact/<uuid>`; query and fragment are dropped; other hosts, http and malformed ids are refused | The CLI keys Design projects by id and checks project URLs end in `/p/<id>`; the artifact forms are the ones the SDK's Artifact tool documents | 2026-10-07 |
| D123 | AL-190: Both canvas kinds are supported; Design artifacts are read with the SDK's built-in `Artifact` tool (read, files listing, read path) | The CLI makes most new designs from Design Artifact types rather than standalone Design projects | 2026-10-07 |
| D124 | AL-190: The canvas schema lives in `packages/contracts/src/domains/design.canvas.ts`, exported with one line in `packages/contracts/src/index.ts`, not in `design.schemas.ts` | Keeps the shared design registration file free for AL-191–AL-199 | 2026-10-07 |
| D125 | AL-190: `apps/desktop/e2e/design-embed.spec.ts` (3 tests) stays as a standing guard of the Electron behaviour the design view relies on, against a local fake site; no spike write-up file: the findings are D111–D125 and the AL-191–AL-197 scope updates | Never contacts claude.ai (§7 rule 6) | 2026-10-07 |
| D126 | AL-023: `selectable` defaults to false, as in React Native; logs, diffs and error details opt in, and nested Text follows its parent unless it sets its own | Dragging across the board must not highlight labels | 2026-10-07 |
| D127 | AL-023: No `Text.web.tsx`: react-native-web's `selectable` (user-select text/none) is enough | Works in Electron 44's Chromium; e2e shows it with a real mouse drag and a triple-click | 2026-10-07 |
| D128 | AL-023: Default sizes and line heights: display 40/44 with -0.025em tracking, title 14/18, body 14/20, meta 12/16, mono 12/18, kept as line-height multiples in Text.tsx; no new tokens | Taken from artboards 1, 3, 6 and 7 | 2026-10-07 |
| D129 | AL-023: `size` prop (a step of the fontSize scale) and `color` override added beyond the ticket scope | Panel headings, footer bands and buttons need them | 2026-10-07 |
| D130 | AL-023: A nested Text inherits the outer variant and size unless it sets its own; a nested variant changes only face and colour | Inline emphasis (bold file names, a mono path in body text) without size mismatches | 2026-10-07 |
| D131 | AL-023: `textStyle(variant, size)` and `textVariants` are exported | TextInput values and placeholders (AL-027) match a variant without RN Text; the gallery (AL-032) lists variants | 2026-10-07 |
| D132 | AL-023: The lint rule is `no-restricted-syntax` (raw Text import from react-native or react-native-web, and any `<X.Text>` JSX element), not more `no-restricted-imports` entries | Flat-config rule options replace rather than merge, so layer rules would be overwritten; typescript-eslint's version is deprecated since 8.64 | 2026-10-07 |
| D133 | AL-023: The lint rule exempts `packages/ui/src/Text.tsx` and `*.test.tsx` | Tests (Card, GlassPanel, Icon) render React Native's Text as a fixture | 2026-10-07 |
| D134 | AL-023: Card's footer label uses `<Text variant="title" size="sm" color={tone text}>`, replacing D35's interim RN Text | Looks the same (bold 12/16) | 2026-10-07 |
| D135 | AL-023: BoardPage text uses the primitive: brand and title `display`, runtime line `mono` muted and `selectable`, logo glyph `title` lg white | The version can be copied into a bug report | 2026-10-07 |
| D136 | AL-023: The contrast test reads each variant's computed colour from the rendered component and checks 4.5:1 on bg, surface and the claude, ado, danger and ok washes | A mutation check confirmed a lighter meta colour (#94A3B8) fails it | 2026-10-07 |
| D137 | AL-061: The Sprint DTO adds `timeFrame` ('past', 'current' or 'future') to `{ id, name, path, start, finish }` | The dropdown can label past and future sprints without date maths | 2026-10-07 |
| D138 | AL-061: `start` and `finish` are calendar days (YYYY-MM-DD), not ISO instants | ADO keeps sprint dates as midnight UTC; formatting an instant in AU or US time zones moves the range by a day | 2026-10-07 |
| D139 | AL-061: `listSprints` returns `{ sprints, currentId }`, oldest first with undated iterations last; `SprintListSchema` refines that only the `currentId` sprint has timeFrame 'current' | One consistent current sprint | 2026-10-07 |
| D140 | AL-061: `$timeframe=current` wins over the full list's `attributes.timeFrame`; a missing or conflicting time frame is worked out from dates against the current sprint's start (or today) | ADO's per-iteration time frame can be missing or disagree | 2026-10-07 |
| D141 | AL-061: `pickSprint(list, selectedId?)` lives in contracts next to the DTO; order: selected id if it still exists, then current, next future, latest past, then null | The renderer can use it without importing ado-client | 2026-10-07 |
| D142 | AL-061: Team is optional in `TeamScope`; leaving it out calls `/{project}/_apis/work/teamsettings/iterations` (the project's default team); `listTeams` does not mark the default team | ADO answers that route for the default team | 2026-10-07 |
| D143 | AL-061: `listTeams` pages with `$top=100`/`$skip`, removes teams repeated across pages, and stops after `DEFAULT_MAX_PAGES` with a 'paging' error | The Teams API has no continuation tokens | 2026-10-07 |
| D144 | AL-061: The iterations response is read from `value` or `values`; a `$timeframe=current` answer without `path` is accepted | ADO sends `value`, the 7.1 docs sample shows `values`; only the current id is used | 2026-10-07 |
| D145 | AL-061: No IPC channel yet; `ado:listSprints` belongs to AL-065 | It needs AL-042's ConnectionsService to pick the client per org; the DTO schemas are ready as its response contract | 2026-10-07 |
| D146 | AL-061: `ado.schemas.ts` imports `z` as a value (not `import type`) and has a sprint block above the channel contracts | Runtime schemas; AL-062–AL-064 will edit the same lines, so integrators keep both sides | 2026-10-07 |
| D147 | AL-061: The contracts test is `ado.sprints.test.ts`, not `ado.schemas.test.ts` | Avoids colliding with a file another E4 ticket adds | 2026-10-07 |
| D148 | AL-015: Handler types and the batched-channel list (`BATCHED_EVENT_CHANNELS`, `EventHandler<C>`, `EventHandlers`) live in `@/shared/api/event-handlers.ts` | Entity slices type their handler maps and cannot import from app/ (FSD) | 2026-10-07 |
| D149 | AL-015: A batched channel's handler gets `readonly EventPayload<C>[]` (every valid event since the last frame, in order); other channels get one payload at a time | Each store commits a frame's batch in one `setState` | 2026-10-07 |
| D150 | AL-015: Entity handlers are registered in `app/entrypoint/event-routes.ts` (`appEventHandlers`, empty for now); each entity exports its handler map from index.ts and adds one line; `hub.register()` returns an unregister function and never touches the bridge | One registration point, one subscription per channel | 2026-10-07 |
| D151 | AL-015: `startEventHub()` is idempotent and is called from `main.tsx` before `runApplication`, not in a React effect | Subscriptions exist before first render; StrictMode or remounts cannot add a second | 2026-10-07 |
| D152 | AL-015: `main.tsx` imports `startEventHub` from `./app/entrypoint/EventHub` directly, not through `app/index.tsx` | Keeps `app/index.tsx` a Fast Refresh boundary and avoids conflicts with AL-140 | 2026-10-07 |
| D153 | AL-015: Each batch flushes on the next animation frame, or after `HIDDEN_FLUSH_DELAY_MS` = 250 ms if no frame comes first | Chromium pauses rAF while the window is hidden; without it the buffer grows and stores go stale | 2026-10-07 |
| D154 | AL-015: Order is kept within a channel but not between a batched and an unbatched channel; consumers order by the event's `at` | Flushing before each unbatched event would add commits per frame | 2026-10-07 |
| D155 | AL-015: Events on a channel with no registered handler are dropped without buffering or logging | Nothing piles up before entities register; renderers opening mid-run backfill over invoke (AL-102) | 2026-10-07 |
| D156 | AL-015: A throwing handler is caught and logged (`An <channel> event handler failed`); other handlers and later events still run; validation logging stays in AL-012's `subscribe` | One bad store cannot break the stream | 2026-10-07 |
| D157 | AL-015: `hub.stop()` unsubscribes and drops buffered events but keeps handlers; `stopEventHub()` forgets the singleton | For tests and teardown only | 2026-10-07 |
| D158 | AL-015: No new e2e test | Production has no registered handlers yet; the existing e2e suite confirms the app starts with the hub subscribed | 2026-10-07 |
| D159 | AL-140: D13 is an in-memory history of typed routes (`{name:'board'} \| {name:'ticket',ticketId} \| {name:'ticketDesign',ticketId}`) in a Zustand store, with `routes.*` builders and `routeToPath`/`parseRoutePath` | React context carries only the store instance, never route state (§6: context is not a store) | 2026-10-07 |
| D160 | AL-140: Router core (route types, store, `RouterProvider`, `useRoute`, `useNavigation`) lives in `shared/routing`; the lazy page map, `AppRouter` outlet and window wiring live in `app/routing` | Pages must navigate and FSD forbids pages importing `app` | 2026-10-07 |
| D161 | AL-140: The current route is mirrored into the location hash with `history.replaceState` (no browser history entries); outside hash changes (`href="#/ticket/1"`, devtools, tests) are followed as navigations | Keeps the page across reloads and dev HMR and lets e2e deep-link | 2026-10-07 |
| D162 | AL-140: Back/Forward also work from Alt+←/→ and the keyboard's Browser Back/Forward keys; Alt+arrows are ignored inside text fields and contenteditable, key repeats are ignored, a component that calls `preventDefault()` first keeps the input; the side-button handler calls `preventDefault()` | Protects word jumps and drafts; Chromium's own history never moves | 2026-10-07 |
| D163 | AL-140: `AppRouter` defers the route with `useDeferredValue`; the fallback (blank view with `aria-busy`) only shows at start-up | Navigating to a page whose chunk hasn't loaded keeps the current page on screen instead of blanking | 2026-10-07 |
| D164 | AL-140: `electron.vite.config.ts` names lazy page chunks `assets/page-<slice>-[hash].js` via `rollupOptions.output.chunkFileNames`; other chunk names unchanged | Rollup otherwise names them all `index`; makes one-chunk-per-page visible and testable | 2026-10-07 |
| D165 | AL-140: Minimal `pages/ticket` (`TicketPage`) and `pages/design-tab` (`DesignTabPage`) with the artboard 3/4 top bar ('← Board' + ticket id) and one cross-link, using plain Pressables and the `Text` primitive | AL-024's Button isn't merged; AL-170 and AL-192 replace the bodies and keep the `ticketId` prop | 2026-10-07 |
| D166 | AL-140: History is capped at 100 entries, navigating to the route already shown does nothing, `navigate(route, { replace: true })` is supported | Bounded memory and no duplicate entries | 2026-10-07 |
| D167 | AL-140: `AppProviders` order is QueryClientProvider > RouterProvider > AL-041's UiPrefsGate; the router connects to the window in a `useEffect` with cleanup | Anything rendered app-wide can navigate | 2026-10-07 |
| D168 | AL-080: No IPC channel; the runner is on Services as `git: GitService` (run, version, checkVersion, ensureSupported, status, worktrees, aheadBehind); `git.names.ts`/`git.schemas.ts` untouched | The ticket asks for a main-process runner for AL-081–AL-090 to use | 2026-10-07 |
| D169 | AL-080: Start-up check shows a non-blocking native warning over the main window once visible ('Get Git' opens https://git-scm.com/downloads) naming the version needed, the version found and what to do; the app keeps running; `main/index.ts` gets one import and one call | Work items can still be browsed without git; the check has to start at launch | 2026-10-07 |
| D170 | AL-080: The runner sets `GIT_TERMINAL_PROMPT=0` and `LC_ALL=C` | No credential prompts; English stderr can be sorted into typed errors such as NOT_A_REPO | 2026-10-07 |
| D171 | AL-080: The runner strips inherited repo-locating variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and the rest of git's local_repo_env list) | A parent git hook cannot point git at another repository | 2026-10-07 |
| D172 | AL-080: stdin is closed and `windowsHide` is set | git never hangs waiting for input; no console window flashes on Windows | 2026-10-07 |
| D173 | AL-080: GitError messages, args and stderr hide URL user-info and Authorization/extraHeader values; Node's exec error is never attached as `cause` | Tokens cannot cross IPC through handleInvoke's error message | 2026-10-07 |
| D174 | AL-080: GitError codes are runner-level (GIT_NOT_FOUND, GIT_TOO_OLD, SPAWN_FAILED, CWD_NOT_FOUND, NOT_A_REPO, TIMEOUT, ABORTED, OUTPUT_TOO_LARGE, INVALID_ARGUMENT, COMMAND_FAILED, PARSE_FAILED); `gitErrorToErr` maps all to INTERNAL for now | AL-083/AL-086/AL-087 map them onto GIT_DIRTY and MERGE_CONFLICT later | 2026-10-07 |
| D175 | AL-080: `status()` runs with `-z` and `GIT_OPTIONAL_LOCKS=0`; `aheadBehind()` puts revisions after `--end-of-options` | A background status never takes index.lock from an agent in the same worktree; a revision can't be read as an option | 2026-10-07 |
| D176 | AL-080: Parsers also accept line-based (C-quoted) output; `worktrees()` returns paths with platform separators | Robust to either output form | 2026-10-07 |
| D177 | AL-080: Smallest piece of the AL-221 kit built: `src/main/git/testing/temp-repo.ts` (temp repo with a bare origin, git cut off from system/global config, hooks and signing, optional reftable) | AL-221 extends it rather than building a second factory | 2026-10-07 |
| D178 | AL-080: The double-quote branch test uses a reftable repo and skips on git < 2.45 | Windows loose refs are files and Windows file names cannot contain `"`, `\|`, `<`, `>` | 2026-10-07 |
| D179 | AL-080: On Windows the e2e test detects the modal warning via `BrowserWindow.isEnabled()`, with a git-present control test | Playwright cannot read native dialogs | 2026-10-07 |
| D180 | AL-080: git test files raise Vitest test/hook timeouts to 60 s | Every git call starts a process, slow on Windows | 2026-10-07 |
| D181 | AL-062: Work items are read with POST `_apis/wit/workitemsbatch` (200-id limit), not GET `workitems?ids=` | A 200-id GET with %2C-encoded commas is ~2.3 KB and could hit URL length limits | 2026-10-07 |
| D182 | AL-062: The sprint list filters by type categories (`IN GROUP 'Microsoft.RequirementCategory' / 'Microsoft.BugCategory' / 'Microsoft.TaskCategory'`) by default; a `types` option (type names) replaces it | Picks up stories, bugs and tasks in any process; `types` is how types are configurable | 2026-10-07 |
| D183 | AL-062: Free functions taking an `AdoClient`; `client.ts` unchanged | Low conflict with AL-061, AL-063, AL-064 | 2026-10-07 |
| D184 | AL-062: `WorkItemSchema` lives in contracts `ado.schemas.ts` (below the sprint block); stateCategory is kebab-case `proposed \| in-progress \| resolved \| completed \| removed \| unknown`; webUrl limited to http(s); description/acceptanceCriteria are ADO HTML or null; `project` (`System.TeamProject`) added | AL-065 sends it over IPC; the URL is opened externally; comments (AL-063) and PRs (AL-064) are project-scoped | 2026-10-07 |
| D185 | AL-062: Web URL is built as `{orgUrl}/{project}/_workitems/edit/{id}` | ADO does not allow `$expand=links` together with `fields` | 2026-10-07 |
| D186 | AL-062: State categories come from `GET {project}/_apis/wit/workitemtypes/{type}/states`, cached in memory per client/project/type with a shared in-flight read; a missing state triggers one re-read; failed reads are not cached | Process edits are picked up without repeated calls | 2026-10-07 |
| D187 | AL-062: If the states read fails, affected items get `unknown` instead of failing the list; 401/403 still return ADO_UNAUTHORIZED/ADO_SCOPE_MISSING | Category only affects colour; credential failures must stay visible | 2026-10-07 |
| D188 | AL-062: Search is per project; a numeric query ('71273' or '#71273') runs an exact-id WIQL alongside the title `CONTAINS` query, listed first and matching any type; a blank query returns [] without calling ADO; top 50 by default, at most 200; query at most 256 chars | The exact id can't be pushed out by the result limit | 2026-10-07 |
| D189 | AL-062: The sprint list sorts by `[System.Id] ASC`, filters `[System.IterationPath] = '<path>'` (AL-061's sprint `path`) and stops at `maxItems` (default 2,000, max 20,000) | Matches artboard 2; 20,000 is WIQL's limit | 2026-10-07 |
| D190 | AL-062: Unreadable ids are dropped via `errorPolicy: 'omit'`; any failed batch fails the call (D77); an unknown id in `getWorkItem` returns ADO's 404 as INTERNAL with `details.status` 404 (D72) | Items deleted between query and read don't fail the list | 2026-10-07 |
| D191 | AL-062: All WIQL text goes through `wiqlString` (doubles single quotes); options are checked with zod before any request (no control characters, length/count limits); bad input returns VALIDATION with `details.kind: 'config'` | No WIQL injection | 2026-10-07 |
| D192 | AL-062: New package exports include `getWorkItems` (bulk read by id, beyond the ticket), `runWiql`, `wiqlString`, `WIQL_MAX_TOP`, `WORK_ITEM_FIELDS`, `DEFAULT_WORK_ITEM_CATEGORIES`, `WORK_ITEMS_BATCH_SIZE` and the defaults/limits | The board needs bulk reads to refresh every card's ADO state (R6) | 2026-10-07 |
| D193 | AL-214: Diagnostics channels are in the app domain (`app:getDiagnostics`, `app:copyDiagnostics`, `app:logError`) with handlers in `src/main/diagnostics/handlers.ts` and one line in `ipc/handlers.ts`; `createAppHandlers` is narrowed to `app:getInfo` and its info builder moved to `app/app-info.ts`; `APP_INVOKE_CHANNELS` is now a multi-line array; `app:logError` returns `z.null()` (first empty response) | `app.names.ts` already planned them; diagnostics reuse the info builder; a one-line array could not take more channels without conflicts | 2026-10-07 |
| D194 | AL-214: The SecretStore (AL-040) gets an optional, guarded `onPlaintext(secret)` hook (called on put and after a successful decrypt), wired in `services.ts` to `log.redactor.addSecret`; its `warn` goes to the log | Smallest change that guarantees any token the app holds is redacted everywhere; a hook failure cannot break the store | 2026-10-07 |
| D195 | AL-214: Redaction has three layers: known values plus their base64, Basic-auth and URL-encoded forms; secret-named fields and env blocks (values dropped, names kept); text shapes (auth headers, Bearer/Basic, URL userinfo, key=value secrets, sk-ant, GitHub, JWT, classic and AZDO ADO PATs). Idempotent; values under 8 characters are never registered | Covers tokens the app knows and ones it doesn't | 2026-10-07 |
| D196 | AL-214: Environment variables are registered as secrets only when the name looks secret and the value looks like a token (16+ chars, no spaces, not a path); `pwd` is not a secret word | e2e found PWD and SSH_AUTH_SOCK-style values redacting file paths out of stack traces | 2026-10-07 |
| D197 | AL-214: The redactor has its own `isSecretName` heuristic instead of reusing contracts' `no-secret-fields.test.ts` one | That one is a schema audit in a test file; the log needs extra words (auth, cookie, sig) and env-block handling | 2026-10-07 |
| D198 | AL-214: Log at `<userData>/logs/main.log`, rotated at 1 MiB keeping 5 files; synchronous appends; rotation falls back to copy-and-truncate when Windows refuses the rename; a log write never throws to its caller | The last lines before a crash are on disk | 2026-10-07 |
| D199 | AL-214: Uncaught exceptions are logged via `uncaughtExceptionMonitor`; unhandled rejections get a listener and are logged as errors | Electron's crash behaviour is unchanged; a rejection no longer ends the main process | 2026-10-07 |
| D200 | AL-214: Main-process `console.warn`/`console.error` are copied into the log (scope `console`); in dev the logger mirrors redacted lines to the terminal through the original console methods | Services that default to the console are captured without wiring; nothing is printed twice | 2026-10-07 |
| D201 | AL-214: `handleInvoke` and the router take an optional log: refused requests are warnings; invalid responses and handler throws are errors with the stack; IPC responses are unchanged | IPC failures reach the log without changing the contract | 2026-10-07 |
| D202 | AL-214: Line format `ISO-time LEVEL [scope] message`, details inline JSON when short and indented otherwise; continuation lines indented; messages capped at 8k chars, details at 20k | A renderer message cannot forge a separate entry; bounded lines | 2026-10-07 |
| D203 | AL-214: Diagnostics include versions, OS, redacted settings, secure-storage status (encryption available, saved-token count, issue kinds; no values), recent errors, and the log folder with the home folder shown as `~`. At integration the settings source became `services.settings.get()` (AL-041 is on main) instead of reading `settings.json` | No values or user paths leak into a bug report | 2026-10-07 |
| D204 | AL-214: The clipboard is written in main (`app:copyDiagnostics`), not via `navigator.clipboard`; e2e checks `app:getDiagnostics` instead | Copying doesn't depend on focus or permissions; test runs don't overwrite the developer's clipboard | 2026-10-07 |
| D205 | AL-214: The renderer reports errors through `app:logError` (error boundaries, window.onerror, unhandled rejections), capped at 30 reports a minute for window/promise sources, fields truncated to `RENDERER_ERROR_LIMITS` | An error thrown in a loop cannot flood the log | 2026-10-07 |
| D206 | AL-214: A reusable `ErrorBoundary`/`ErrorFallback` lives in renderer `shared/ui` (artboard 6 error-toast layout: alert tile, Retry, Copy diagnostics, status line) and `AppErrorRoot` wraps the app root in `main.tsx`; buttons are a local Pressable `ActionButton` until AL-024's Button lands | AL-210 wraps pages, lanes and panels with it instead of building new boundaries | 2026-10-07 |
| D207 | AL-064: PR DTOs and pure helpers (`summarizeChecks`, `isPullRequestClosed`/`pullRequestOutcome`, `formatPullRequestActivity`) live in `packages/contracts/src/domains/ado.pull-requests.ts`, exported with one line in `contracts/src/index.ts`; ado-client functions in `packages/ado-client/src/pull-requests.ts` | Avoids collisions with AL-061–AL-063 in `ado.schemas.ts`; AL-065 imports them for `ado:createPullRequest` / `ado:getPullRequest` | 2026-10-07 |
| D208 | AL-064: No IPC channels, main service or renderer code | Those belong to AL-065, AL-066, AL-144 and AL-181 | 2026-10-07 |
| D209 | AL-064: Checks = enabled, not-deleted, applicable branch policy evaluations (`_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{prId}`) plus the latest PR status per genre/name (`.../pullRequests/{id}/statuses`), both on api-version 7.1-preview.1 | Those APIs are still preview in 7.1 | 2026-10-07 |
| D210 | AL-064: Check states: approved/succeeded/partiallySucceeded pass; rejected/broken/failed/error fail; queued/running/pending/notSet/unknown pending; notApplicable not counted | A partially succeeded build satisfies ADO's build policy | 2026-10-07 |
| D211 | AL-064: Every check, required or optional, counts towards total; each carries `required` (policy `isBlocking`; plain statuses optional); required policies listed first. A status enforced by an applicable Status policy is counted once, as the policy (genre/name, case-insensitive) | Matches what ADO shows on the PR; no double counting | 2026-10-07 |
| D212 | AL-064: Build policy checks link to `{org}/{project}/_build/results?buildId=N` and, when failing, carry the first `buildOutputPreview` error as `detail`; status checks use their description and an http(s)-only `targetUrl` | The card can show why a check failed and link to it safely | 2026-10-07 |
| D213 | AL-064: `createPullRequest` is idempotent: a 409 TF401179 reuses the active PR for the same branches (`created: false`); after create or reuse it reads back with `includeWorkItemRefs=true` and adds a missing work item link as an ArtifactLink (`vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{prId}`) via PATCH on the org-level work item URL. A failure after creation keeps its code and starts "Pull request !N was created, but …" | Retries are safe; work items in other projects link too | 2026-10-07 |
| D214 | AL-064: Validation before any request: git check-ref-format branch names (`refs/heads/` accepted and stripped), source ≠ target, title 1–400, description ≤ 4000 (`PULL_REQUEST_DESCRIPTION_MAX`, for AL-181 to trim the draft), ≤ 50 work item ids | Bounded input; ADO's own limits | 2026-10-07 |
| D215 | AL-064: Merge statuses are kebab-cased (`not-set`, `rejected-by-policy`, …), unknown → `not-set`; an unknown PR status fails with VALIDATION | Never guess whether a ticket is Done | 2026-10-07 |
| D216 | AL-064: `PullRequestRef` / `pullRequestRef(pr)` identify a PR by project and repository GUIDs; `webUrl` is `{org}/{project}/_git/{repo}/pullrequest/{id}`, http(s) only | The ticket record survives renames | 2026-10-07 |
| D217 | AL-064: `parseAdoGitRemote` (`ado-client/src/git-remote.ts`) reads org URL, project and repo from dev.azure.com, visualstudio.com, SSH v3 and Azure DevOps Server remotes; errors never echo the remote; Server remotes must include the project | The Create PR stage needs project and repo for a local repo and no ticket covered it | 2026-10-07 |
| D218 | AL-064: `formatPullRequestActivity` → "PR !N · x / y checks" ("1 / 1 check", "no checks"), "PR !N" while checks are unknown, "PR !N · merged" / "· abandoned" once closed | Exactly the artboard 6 card text | 2026-10-07 |
| D219 | AL-064, AL-063: At integration both DTO files use AL-062's shared `WorkItemIdSchema` instead of private copies (same bounds) | One definition of a work item id | 2026-10-07 |
| D220 | AL-042: Connection records live in an app-written `<userData>/connections.json` (electron-store, version 1), not in `settings.json` | `settings:get`/`settings:update` are open to the renderer; AL-041's schema stays untouched | 2026-10-07 |
| D221 | AL-042: `MaskedTokenSchema` only accepts eight bullets plus at most the last 4 printable characters; tokens shorter than 16 chars show bullets only. The masked tail is stored at save time, so listing never decrypts | A full token cannot fit in any response field | 2026-10-07 |
| D222 | AL-042: Ids: `ado:<org slug>` (-2, -3 … on a clash), `mcp:<name slug>`, `claude` (one Claude connection); secret ids follow D23 (`ado:<slug>`, `claude:api-key`, `mcp:<slug>`) | Stable, readable ids | 2026-10-07 |
| D223 | AL-042: Save refuses a duplicate (same org URL case-insensitive, same MCP name, second Claude) with VALIDATION and `{id}`, pointing at Replace. `connections:replace` takes `{id, draft}` of the same kind, keeps id, createdAt and the default project when omitted, clears expiresAt, resets status, and restores the old token if the record write fails | No silent overwrite; replace is all-or-nothing | 2026-10-07 |
| D224 | AL-042: `connections:remove` deletes the secret, then the record; unknown id → ok `{removed:false}`. Start-up deletes orphan connection-owned secrets (`ado:`/`claude:`/`mcp:` ids) only when `connections.json` was read cleanly | A corrupt or partly malformed file never costs the user tokens | 2026-10-07 |
| D225 | AL-042: A corrupt `connections.json` is renamed `connections.corrupt-<time>.json`; an unreadable (I/O) or newer-version file is left alone and changes are refused until it can be read | Same recovery rules as settings and secrets | 2026-10-07 |
| D226 | AL-042: Rows carry `needsReconnect` (status `error`, reconnect message) when the saved token is missing or no longer decrypts; start-up decrypts each referenced token once and discards it | Data side of AL-040's open reconnect criterion | 2026-10-07 |
| D227 | AL-042: A draft test outcome is remembered in memory for 15 minutes, keyed by sha256 of kind + URL + token; testing a saved id updates its row and emits `connections:changed` | Save right after Test shows ok and the identity without a second call | 2026-10-07 |
| D228 | AL-042: Testers are pluggable per kind (`ConnectionTesters`); only a minimal ADO tester ships (GET `_apis/connectionData`, 7.1-preview.1, one retry, returns the identity). A kind without one returns INTERNAL "not available yet" | AL-043–AL-045 add the rest | 2026-10-07 |
| D229 | AL-042: Tester messages and identities are scrubbed of the token (raw, base64, Basic `:token` base64, URL-encoded) before being returned, stored or logged | No leak through error text | 2026-10-07 |
| D230 | AL-042: `connections:changed` stays envelope-only (`{at}`); the renderer refetches the list | Required id/change fields would have broken existing event tests | 2026-10-07 |
| D231 | AL-042: MCP draft shape: transport stdio `{command, args, envVar}` or http/sse `{url, header}`; a token needs envVar or header; URLs with embedded credentials are refused. Expiry is an optional user-entered ISO date (proposed default for Q10). No renderer hooks yet (AL-046) | AL-045 refines MCP; AL-046 owns the UI | 2026-10-07 |
| D232 | AL-042: Main-only `secret(id)` and `sessionEnv()` (`ANTHROPIC_API_KEY`) accessors on the service; at integration its start-up warnings go to `log.child('connections')` | For AL-063/AL-100/AL-108; problems reach the app log (AL-214) | 2026-10-07 |
| D233 | AL-063: `adoStateTransitions: boolean` (default false) is a top-level setting next to `buildQueueSize`, no version bump: the loader fills the default | AL-146 lists it as a global setting; AL-041 rules allow additive defaults | 2026-10-07 |
| D234 | AL-063: The settings gate lives in main (`createWorkItemWriteBack`, `apps/desktop/src/main/ado/write-back.ts`), reading `settings.get()` on every call; while off it returns ok `{ outcome: 'disabled' }` without asking for a client. It takes an injected `clientFor(org)` and is not registered in `services.ts` yet | Turning the setting off stops the next change; the per-org client comes with AL-065 | 2026-10-07 |
| D235 | AL-063: `listWorkItemComments` added (not named in the ticket) | Lets the "visible in ADO" check read back; AL-065 `ado:getComments` and AL-115's no-duplicate check need it | 2026-10-07 |
| D236 | AL-063: Comments go to the Comments API (7.1-preview.4) with `format=html`: plain text HTML-escaped, line breaks as `<br>`, prefixed "Agent Lanes · " | Text like `<frmJobControl>` can't vanish; HTML is supported by Services and Server | 2026-10-07 |
| D237 | AL-063: `setWorkItemState` reads `System.State` first; same state (case-insensitive) → `unchanged`, nothing written; otherwise the PATCH has a `test /rev` op, and 409/412 becomes INTERNAL "nothing was written". An optional `reason` goes into `System.History` (prefixed) in the same revision | Never overwrites someone else's change | 2026-10-07 |
| D238 | AL-063: Comment text ≤ 10,000 chars (`WORK_ITEM_COMMENT_MAX_LENGTH`); state names ≤ 128 chars, no control characters | Bounded input | 2026-10-07 |
| D239 | AL-063: Write-back DTOs live in `packages/contracts/src/domains/ado.write-back.ts`, exported with one line in `contracts/src/index.ts` | Avoids collisions in `ado.schemas.ts` | 2026-10-07 |
| D240 | AL-063: `isAgentLanesComment` also recognises the prefix inside leading markup and with the dot/space stored as an entity (`&middot;`, `&#183;`, `&nbsp;`), looking at the first 2,000 chars only | ADO may rewrite stored HTML; fast on hostile input | 2026-10-07 |
| D241 | AL-063: Comment dates become plain ISO instants; `updatedAt` is null when modifiedDate equals createdDate | ADO sends 7-digit fractions and sets both on an unedited comment | 2026-10-07 |
| D242 | AL-191: Channels `design:open {ticketId, url, bounds?}` → DesignViewState; `design:setBounds`, `design:hide`, `design:close` → `{found}`; `design:getView` → `{view\|null}`. Event `design:view {ticketId, at, status, url, visible, closed}` | Feeds AL-192's sign-in pill and AL-193's relink | 2026-10-07 |
| D243 | AL-191: View status `loading \| signed-in \| signed-out \| load-failed`; signed-out = claude.ai `/login`, `/logout`, `/signup`, `/sso`, `/magic-link`, `/auth` or an identity-provider page, where the reported URL drops query and fragment; canvas URLs are kept whole | Sign-in URLs can carry one-time tokens; AL-193 needs the full canvas URL | 2026-10-07 |
| D244 | AL-191: `design:open` with the URL the view was opened with only shows it again; a different URL navigates. One view visible at a time | Keeps canvas state; a relinked canvas still loads | 2026-10-07 |
| D245 | AL-191: Navigation allow-list: https claude.ai plus accounts.google.com, appleid.apple.com, login.microsoftonline.com, login.live.com, *.okta.com, *.workos.com (default port, no userinfo). Blocked top-level links open in the OS browser (https only); blocked redirects are stopped; sub-frames left alone; `<webview>` refused; allowed popups are child windows in the same partition with the same guards | D114; enterprise SSO hosts may need adding to `AUTH_HOSTS` | 2026-10-07 |
| D246 | AL-191: Design-partition permissions are denied except clipboard-sanitized-write and fullscreen on allow-listed origins | Electron grants every permission by default | 2026-10-07 |
| D247 | AL-191: `AGENT_LANES_DESIGN_TEST_ORIGIN` adds one exact origin treated as claude.ai, read in `main/index.ts` only when `app.isPackaged` is false | e2e uses a local fake site and never contacts claude.ai | 2026-10-07 |
| D248 | AL-191: Placeholder bounds arrive in CSS pixels; main rounds them and multiplies by the renderer's zoom factor | The view lines up at any zoom | 2026-10-07 |
| D249 | AL-191: LRU limit `DEFAULT_MAX_LIVE_DESIGN_VIEWS` = 3; an evicted view emits `design:view` with `closed: true` | Bounded memory | 2026-10-07 |
| D250 | AL-191: Electron code sits in `design/electron-platform.ts` behind `DesignViewPlatform`; `view-service.ts` and `guards.ts` are plain logic tested with fakes | Testable in the Vitest main project | 2026-10-07 |
| D251 | AL-191: Renderer piece is `useDesignViewSlot(ticketId, url)` in `shared/api/design-view.ts`, not a new FSD slice | A slice nothing imports fails Steiger's insignificant-slice rule; AL-192 uses it | 2026-10-07 |
| D252 | AL-191: `services.ts` gains `designView` plus options `mainWindow` and `designTestOrigin`; `disposeServices` closes the views and calls `cookies.flushStore()`; `main/index.ts` passes these options | The service needs the window; sign-in survives restarts | 2026-10-07 |
| D253 | AL-025: Every tone in `packages/tokens/src/tones.ts` gains a `dot` colour (claude #5B4BC4, ado #0369A1, attention #D97706, danger #B91C1C, ok #059669), mirrored as `--al-tone-*-dot`; tests check they equal the matching `color` tokens. Status dots use the tone's strong colour, not its text colour | Matches the artboard 6 dots | 2026-10-07 |
| D254 | AL-025: New `neutral` tone (band #F1F5F9, text #475569, dot #94A3B8, sampled from artboard 6 "Queued") in tones.ts and the CSS; text about 6.9:1 on its band | §11 had no grey for idle states | 2026-10-07 |
| D255 | AL-025: `PillTone` is the tokens `Tone` type (claude, ado, ok, attention, danger, neutral); `Pill` defaults to neutral, size `sm`, no dot | One tone vocabulary for tokens and UI | 2026-10-07 |
| D256 | AL-025: Pill sizes `sm` = 22 px, bold 12/16, 8 px sides (artboard 6 status badges) and `md` = 28 px, 14/20 body weight, 10 px sides (artboard 1 header counts such as "4 running", "MCP online"; the artboard looks ~13 px, 14 is the nearest fontSize step) | Both artboard sizes are needed | 2026-10-07 |
| D257 | AL-025: Pill `label` is a required string (no icon-only or empty form); the dot is `aria-hidden`, so a screen reader reads only the word | No colour-only pill is possible through the API | 2026-10-07 |
| D258 | AL-025: Pill and IdChip text is one line (`numberOfLines={1}`), `alignSelf: flex-start`, `flexShrink: 0` | A pill hugs its label and its word is never squeezed or cut | 2026-10-07 |
| D259 | AL-025: StatusBadge statuses are kebab-case `running \| done \| queued \| needs-you \| switching` (`BadgeStatus`, `badgeStatuses`, `statusLabel()`); "Switching · next turn" uses the ado tone with no dot, as on the artboard | Matches contracts' vocabulary style | 2026-10-07 |
| D260 | AL-025: One colour set per tone, from the artboard 6 status badges; artboard 1's slightly darker header-pill text ("1 queued" #334155, "MCP online" #065F46) is not copied | One-off differences; one source of truth | 2026-10-07 |
| D261 | AL-025: `Badge` is white with neutral text, or amber (attention band and text); minWidth 40, 24 px tall, bold 12 px. Negative or non-finite counts show 0, fractions are floored | Artboard 1/6 lane badges | 2026-10-07 |
| D262 | AL-025: `Badge` has role="img" and an accessible name: the count, plus ", needs you" for amber by default, and an optional `label` prop for a fuller name (e.g. "3 tickets, 1 needs you") | The amber is never the only signal | 2026-10-07 |
| D263 | AL-025: `IdChip` is mono 11 px weight 400, #0369A1 on #E0F2FE, radius 8 (chip), 6 px sides, 19 px tall. The artboard's id looks bold, but only JetBrains Mono 400 is bundled (§11, AL-021) | Sizes measured from artboards 1 and 6 | 2026-10-07 |
| D264 | AL-025: `IdChip` takes a number or string id and drops a leading "#" and spaces | Callers can pass either form | 2026-10-07 |
| D265 | AL-101: `TicketIdSchema` (contracts `events.ts`) tightened as D37 asked: AL-082's folder format, lowercase ASCII words joined by single dashes, at most 64 chars, never a Windows device name (`con`, `nul`, …); `TICKET_ID_PATTERN` and `TICKET_ID_MAX_LENGTH` exported. The build queue's `ticketId: z.string().min(1)` is unchanged | The id is used as a file and folder name; queue tests still use 'AL-1' ids | 2026-10-07 |
| D266 | AL-101: `TicketRecordSchema` (version 1) lives in `contracts/src/domains/tickets.schemas.ts`; no IPC channels added. Fields: id, title, ado {orgUrl, project, workItemId} or null, repo, baseBranch, branch, worktreePath, subBranches, stage, stageHistory, gates (settings `StageGatesSchema`), model, effort, skills, sessionId, lastBuild, lastRun, design, createdAt, updatedAt | Scope is storage only | 2026-10-07 |
| D267 | AL-101: Record has a `title` (beyond the scope list) | A "No ticket" card can be rebuilt after a restart without asking ADO | 2026-10-07 |
| D268 | AL-101: Timestamps are epoch milliseconds | Same as events (D36) | 2026-10-07 |
| D269 | AL-101: Stage times are a `stageHistory` list capped at 200 entries; callers only set `stage`, the store adds the history entry and stamps `updatedAt` | Code review and QA can send a ticket back to Implementing (§9), so a stage can be entered more than once | 2026-10-07 |
| D270 | AL-101: `repoKey` = the repo folder name made file-safe plus 12 hex chars of the SHA-256 of its normalized path (lowercased on Windows), e.g. `onsite-companion-3f2a9c1b04d7` | Readable, and same-named repos never share a folder | 2026-10-07 |
| D271 | AL-101: Ticket ids are unique across all repos; `create` refuses an id that exists in another repo | Events and the renderer identify tickets by id alone | 2026-10-07 |
| D272 | AL-101: Writes debounced: 250 ms after the last change, at most 1 s after the first unsaved change. `create`/`delete` reach disk before resolving; `flush(id?)` writes now; `dispose()` flushes all (in `disposeServices` after the build queue) and later writes are immediate. A failed write stays in memory, retries after 5 s, and `flush` reports INTERNAL | Fewer writes without losing changes on quit | 2026-10-07 |
| D273 | AL-101: A record that is not valid JSON or fails the schema is renamed `<id>.corrupt-<time>.json` and reported by `issues()`; a newer-version record is left alone and never overwritten; `create` never replaces a file the loader did not read; when one id has records in two repo folders the newer `updatedAt` wins and the other is reported | Never lose or clobber data | 2026-10-07 |
| D274 | AL-101: The store refuses (VALIDATION) non-absolute repo or worktree paths, and any record whose file would land inside its repo, worktree or a sub-branch worktree | The keep-out-of-worktrees check needs absolute paths | 2026-10-07 |
| D275 | AL-101: `design` holds AL-190's `DesignCanvasRefSchema`, `lastViewUrl` (https://claude.ai/ only) and one entry per shipped spec version (version, shippedAt, approvedBy, artboardCount, usedAt), versions increasing; spec content is AL-197's. Embed mode stays in settings `ui.embedModeByTicket` (AL-041) | One home per value | 2026-10-07 |
| D276 | AL-101: `lastBuild` = {outcome succeeded/failed/cancelled, startedAt, finishedAt, errors, warnings}; `lastRun` = {startedAt, stoppedAt, exitCode, url} | What the card and drill-in show after a restart | 2026-10-07 |
| D277 | AL-101: `tickets/atomic-file.ts` has its own small rename-with-retry helper rather than exporting AL-040's private one | No refactoring other tickets' code | 2026-10-07 |
| D278 | AL-101: The kill test runs the real store in a plain Node child via Node's type stripping and a resolve hook (`testing/strip-types-hooks.mjs`); needs Node ≥ 22.15 for `registerHooks` | No tsx/esbuild dependency; fits `>=22.18` | 2026-10-07 |
| D279 | AL-101: e2e `tickets.spec.ts` checks start-up loading, corrupt records set aside, temp files removed, and no rewrite of unchanged records on quit. Test helpers for AL-090/AL-110 in `src/main/tickets/testing`: `newTicketInput`, `createTempDir`, `listTree`, `createMemoryRecordFs`, `createCrashingFs` | Proves the store is wired into the real app | 2026-10-07 |
| D280 | AL-026: New token group `selection` in `packages/tokens/src/selection.ts` (track #EEF2F7, label #475569, switchOff #CBD5E1, thumbShadow, pillShadow, disabledOpacity 0.5) with a matching `--al-selection-*` CSS block; `selection.test.ts` checks the CSS sync and 4.5:1 label contrast | Values sampled from artboards 2 and 3; a separate file avoids colliding with other E2 tickets editing `color` | 2026-10-07 |
| D281 | AL-026: One label colour (#475569) for unselected track segments, unselected effort pills and switch side text | Artboard 3's pills use a slightly darker slate (#334155), but one token keeps the set small | 2026-10-07 |
| D282 | AL-026: `SegmentedControl` has `variant: 'track' \| 'pills'`; `pills` is artboard 3's effort pills | Beyond the ticket text, but AL-171 needs it | 2026-10-07 |
| D283 | AL-026: `SegmentedControl` has `tone: 'claude' \| 'ink'` (default claude): violet text for Effort and model, ink for Sprint / Search / No ticket | Meets "violet text where the artboard shows it" | 2026-10-07 |
| D284 | AL-026: `fill` prop stretches equal-width segments across the row (Effort, model); without it the track hugs its labels (work item control) | Both layouts appear on the artboards | 2026-10-07 |
| D285 | AL-026: Track labels are bold (700) in every state; pills go from 500 to 700 when selected | Artboard labels look semibold and 600 isn't bundled; constant weight stops neighbours reflowing on selection | 2026-10-07 |
| D286 | AL-026: Track is 44 px (artboards draw 42 and 46) with a 4 px thumb inset; each whole slot is the radio, so every segment is a 44 px target; effort pills stay 34 px tall inside a 44 px slot | Min target size | 2026-10-07 |
| D287 | AL-026: The focus ring is the app's global `:focus-visible` outline with an inline `outlineOffset: -2`, ringing the visible thumb or pill rather than the 44 px slot | react-native-web inserts its stylesheet first in `<head>`, so a class would lose to global.css | 2026-10-07 |
| D288 | AL-026: `Switch` is the whole artboard row (label, side text, 38×22 toggle with 16 px knob, 48 px tall, 14 px side padding) with `stateText: {on, off}`; its accessible name comes from `aria-labelledby` on label plus state text (e.g. "Planning Needs approval") | React Native's types have no `aria-describedby` | 2026-10-07 |
| D289 | AL-026: Space toggles the switch on keydown and ignores key repeat; Enter works through react-native-web's PressResponder; `SegmentedControl` handles Space itself | PressResponder only handles Space for buttons | 2026-10-07 |
| D290 | AL-026: Knob slide, track colour and thumb fill use the design's 150 ms ease-out through `selectionMotion.web.ts`; native `selectionMotion.ts` has no transitions; the web file needs one cast | React Native's style types don't list CSS transition properties | 2026-10-07 |
| D291 | AL-026: Switch off track #CBD5E1 is under 3:1 on white, as on the artboard; state is never shown by colour alone (knob position and side-text word) | Matches the artboard; AL-033 should review against WCAG 1.4.11 | 2026-10-07 |
| D292 | AL-024: Fifth Button variant `danger` (white fill, `tone.danger.border` outline, `color.danger` label) for artboard 5's Remove button | AL-046 doesn't need its own button | 2026-10-07 |
| D293 | AL-024: Sizes `md` (44 px tall, 18 px sides, 14 px bold label, 16 px icon) and `sm` (38 px visible surface, 14 px sides, 12 px label, 14 px icon, as Replace/Remove on artboard 5); both keep a pressable target of at least 44×44 by putting the surface inside the target | The artboard's sm label measures about 13 px, which is not on the fontSize scale | 2026-10-07 |
| D294 | AL-024: `trailingIcon`, `iconOnly` (label becomes the aria-label; a union type makes `icon` required) and `justify: 'center' \| 'between'` | Covers "Launch agent →", the Connections icon button and the drill-in's full-width merge buttons | 2026-10-07 |
| D295 | AL-024: New `control` token group in `packages/tokens/src/controls.ts` with a mirrored `:root` block: `ink` #334155, primary violet shadows at rest and on hover, `pressedFilter` brightness(0.94), `disabledOpacity` 0.5; `controls.test.ts` checks the CSS mirror and text contrast | Values sampled from artboards 3, 5 and 7 | 2026-10-07 |
| D296 | AL-024: Only the primary button has a shadow at rest (violet); on hover primary takes a deeper violet shadow and the others take `shadow.lifted` | Sampled from artboard 7 | 2026-10-07 |
| D297 | AL-024: Only the inner surface lifts 3 px on hover, not the pressable target; one 220 ms (`motion.slowMs`) transition with `motion.easing` covers transform, box-shadow and filter; pressing drops the lift and applies `pressedFilter` | The pointer never slips off the edge, so hover doesn't flicker; react-native-web's added `-webkit-filter` breaks a per-property duration list | 2026-10-07 |
| D298 | AL-024: `variant` defaults to `secondary`, `size` to `md` | Neutral default; primary is chosen explicitly | 2026-10-07 |
| D299 | AL-024: react-native-web renders `role="button"` as a native `<button type="button">` (Enter/Space activate natively); disabled sets the `disabled` attribute plus `aria-disabled="true"`, so Tab skips it | Announced as unavailable; if disabled buttons should stay focusable Button would need a non-`<button>` element | 2026-10-07 |
| D300 | AL-024: `loading` doesn't disable the button: it removes onPress, sets `aria-busy`, shows an ActivityIndicator in the leading-icon slot, keeps the label and doesn't fade | A natively disabled button loses keyboard focus | 2026-10-07 |
| D301 | AL-024: The focus ring (focusRing tokens: 2 px violet, 2 px offset) is drawn on the surface and shows only for keyboard focus, tracked with capture-phase keydown/pointerdown listeners in `interaction.web.ts` | jsdom gets `:focus-visible` wrong on a second Tab; in Electron the result matched Chromium's `:focus-visible` | 2026-10-07 |
| D302 | AL-024: The target's own global `:focus-visible` outline is turned off with an inline `outlineWidth: 0` so only one ring shows | react-native-web inserts its class rules ahead of the app CSS, so a class would lose to the global rule | 2026-10-07 |
| D303 | AL-024: Web-only code (keyboard tracking, CSS transitions) is in `packages/ui/src/interaction.web.ts`; native `interaction.ts` always shows the ring and has no transitions; `isFocusVisible` and `liftTransition` are reusable by AL-026/AL-029 | Keeps DOM code out of the native build | 2026-10-07 |
| D304 | AL-024: `@testing-library/user-event` is a devDependency of `packages/ui` | Tests press Tab, Shift+Tab, Enter and Space and hover like a real user | 2026-10-07 |
| D305 | AL-081: A refused folder is not an error Result: main shows a native error box parented to the window ("\"Downloads\" is not a git repository.", "Choose another folder…" / "Cancel"), and on Cancel `repos:add` returns ok `{ status: 'rejected', reason, folder, repos }` | The picker is native and owned by main, the error is visible without AL-030's ToastHost, and callers never show it twice | 2026-10-07 |
| D306 | AL-081: The `repos:add` outcome is a union `added \| existing \| cancelled \| rejected`, each carrying the full `repos` list; error Results are kept for git missing or too old (checked with `ensureSupported` before the dialog opens, INTERNAL with gitCode) and a failed settings save | Callers report only real failures | 2026-10-07 |
| D307 | AL-081: "Choose another folder…" reopens the picker in the refused folder; the first picker opens in the parent of the last registered repo | Repos usually sit side by side | 2026-10-07 |
| D308 | AL-081: The registered path is always the repo's main checkout: a sub-folder resolves to its work tree root (`rev-parse --show-toplevel`), a linked worktree to the main worktree (first `worktree list` entry when `--git-dir` ≠ `--git-common-dir`) | D63: a repo is identified by its main checkout, so it is registered only once | 2026-10-07 |
| D309 | AL-081: Folder problems are typed `RepoFolderProblem`: not-a-repo, bare-repo, git-dir (inside .git), bare-main (linked worktree of a bare repo) and unreadable (git COMMAND_FAILED, CWD_NOT_FOUND, TIMEOUT; shows git's stderr, e.g. "dubious ownership") | Precise messages per cause | 2026-10-07 |
| D310 | AL-081: Default-branch detection: `origin/HEAD` (symbolic-ref, never contacts the remote), then `main` if it exists locally or on origin, then `master`, then `main`; if detection fails `main` is used and the repo is still registered | A local-only or older repo with only `master` would otherwise get a base branch that doesn't exist | 2026-10-07 |
| D311 | AL-081: Repo paths compare case-insensitively and ignore a trailing separator on Windows and macOS (`repoPathKey`/`isSameRepoPath`), for the "existing" check and `repos:remove` | Case-insensitive file systems | 2026-10-07 |
| D312 | AL-081: Only one folder picker opens at a time; a second `repos:add` meanwhile gets the same promise and outcome | No stacked native dialogs | 2026-10-07 |
| D313 | AL-081: Dialogs are an injectable `RepoDialogs` interface; the Electron version (`repos/electron-dialogs.ts`) finds its parent at call time (focused window, else first visible) and reads `dialog.*` at call time | Services hold no window (D42), `main/index.ts` unchanged, e2e can stub showOpenDialog/showMessageBox in main | 2026-10-07 |
| D314 | AL-081: `repos:remove` only removes the settings entry, touches nothing on disk, returns `{ removed: false }` for an unknown path without writing, and doesn't clear `ui.lastRepo` | The renderer's persisted Zustand store owns `ui` and would write a stale value back | 2026-10-07 |
| D315 | AL-081: The `repos` domain imports `RepoSettingsSchema`/`ReposSchema` from settings.schemas (repos stay in the settings document); `repos/*.ts` import `../git/git-error` and `../git/git-service`, not the git index | No second store; main-project tests don't load `electron` (the git index re-exports git-dialog) | 2026-10-07 |
| D316 | AL-081: Renderer hooks `useRepos`/`useAddRepo`/`useRemoveRepo` (query key `['repos']`, staleTime Infinity) in `shared/api/repos.ts`; the mutations update both the repos cache and the cached settings' `repos`. No UI: the Repo dropdown is AL-142, the first-run picker step AL-047 | Ready for AL-142 and AL-047 | 2026-10-07 |
| D317 | AL-081: e2e `repos.spec.ts` builds its git fixture with execFileSync and an isolated config instead of importing `src/main/git/testing` | No existing spec imports runtime code from src/ through Playwright's transform | 2026-10-07 |
| D318 | AL-027: Variants are one `variant` prop (`text`, `multiline`, `secure`, `search`), not boolean flags | Impossible combinations such as a secure multiline field cannot be written | 2026-10-07 |
| D319 | AL-027: A secure field has no `value`, `defaultValue` or `onChangeText` (blocked by its types). The form reads the secret through a `SecureTextFieldHandle` ref: `read()` leaves it in place (Test connection), `take()` returns and clears it (Save or Enter), `clear()` empties it (Cancel); `onSecretChange(filled)` reports only whether the field is empty | Keeps the token out of parent state, stores and logs | 2026-10-07 |
| D320 | AL-027: The secure input is uncontrolled and holds the secret in a single `useRef`, not `useState` | A probe showed React copies a controlled input's value into the DOM `value` attribute (token in the markup); a ref leaves no stale copy in React's previous render | 2026-10-07 |
| D321 | AL-027: The 'cleared from component state' test walks React's committed tree (props and hook state) for the secret, after first checking the secret is found while typed | If React internals change, the test fails instead of passing silently | 2026-10-07 |
| D322 | AL-027: Secure fields render `type=password`, `autocomplete=off`, `autocorrect=off`, `autocapitalize=none`, `spellcheck=false` | `off` rather than `new-password`: Electron has no password manager | 2026-10-07 |
| D323 | AL-027: The violet focus ring (`focusRing` token: 2 px, offset 2) is drawn on the whole box while the input has focus; the input's own outline is removed with an inline style (beats the global `:focus-visible` rule) | Otherwise the search field's ring would sit between the icon and the text | 2026-10-07 |
| D324 | AL-027: `aria-describedby` lists the error first, then the help text. The error also sets `aria-invalid`, a red box border and an alert icon | The state is not shown by colour alone | 2026-10-07 |
| D325 | AL-027: The field is named by its visible label through `aria-labelledby` (ids from `useId`); the types require `label` or `aria-label`. The search variant gets `role=searchbox` and `enterKeyHint=search` | The search field on artboard 2 has no visible label | 2026-10-07 |
| D326 | AL-027: Sizes from artboards 2 and 5: 46 px box (44 inside a 1 px `line` border), radius 12, 12 px inset, 16 px muted search icon, value in `body` type, placeholder in `muted`; labels use Text `title` at 14 px in ink | Artboard 2 matches; artboard 5's labels measure about 13 px in #334155, which is not a token | 2026-10-07 |
| D327 | AL-027: The disabled fill uses `color.bg` (#F4F7FB), not artboard 5's #F8FAFC; disabled fields are not editable and set `aria-disabled` | Avoids a new token; React Native's TextInput types have no `disabled` prop | 2026-10-07 |
| D328 | AL-027: Multiline is a textarea with `rows` (default 5), min height rows × 20 + 28, `resize: vertical` on web; Enter adds a new line and never submits | Artboard 2 shows a resizable job description | 2026-10-07 |
| D329 | AL-027: An `accessory` prop (beyond scope) puts a control on the box's row and keeps label and help text aligned to the box; in single-line fields Enter calls `onSubmitEditing` and focus stays in the field (`blurOnSubmit` false) | Artboard 5's 'Test connection' sits beside the PAT | 2026-10-07 |
| D330 | AL-044: New invoke channel `connections:detectClaude` (request undefined → `ClaudeLoginDetection {found, identity, email, organization, plan, provider, message, checkedAt}`) in the connections domain, served by `ConnectionsService.detectClaudeLogin()` | The ticket named no channel; a separate domain would have meant more shared registration files | 2026-10-07 |
| D331 | AL-044: Claude-specific contract pieces live in `packages/contracts/src/domains/connections.claude.ts` (detection schema, `CLAUDE_LOGIN_CONNECTED_TEXT`, `claudeConnectionStatusLine(row)`), exported with one line in contracts `index.ts` | Keeps `connections.schemas.ts` edits to two lines; AL-046 renders the status line from it | 2026-10-07 |
| D332 | AL-044: Detection starts Claude Code with a streaming input that never sends a message and reads `accountInfo()` from the SDK's initialize handshake; it runs only when asked, never on start-up | No model request is made | 2026-10-07 |
| D333 | AL-044: A login counts as found when `tokenSource` is set (claude.ai or OAuth token), when `apiKeySource` is '/login managed key' or 'apiKeyHelper', or when `apiProvider` is not firstParty (Bedrock, Vertex, Foundry, gateway). An `ANTHROPIC_API_KEY` from the environment never counts | Those are the cases where Claude Code authenticates itself | 2026-10-07 |
| D334 | AL-044: `claudeProcessEnv` drops an inherited `ANTHROPIC_API_KEY` in login mode; in API-key mode it sets the saved key and drops `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` | The credential the user chose is the one tested and used; an exported key would otherwise silently override the login in headless mode | 2026-10-07 |
| D335 | AL-044: Check processes (detect and test) run with `settingSources: []`, `strictMcpConfig`, `mcpServers: {}`, `tools: []`, `persistSession: false` and cwd = OS temp | A throwaway check runs none of the user's hooks, plugins or MCP servers and leaves no transcript. Side effect: a setup only in ~/.claude/settings.json (apiKeyHelper, env block) is not seen by detection | 2026-10-07 |
| D336 | AL-044: The test uses model alias 'haiku' (not D10's pinned id), a short custom system prompt, `thinking: disabled`, `maxTurns: 1` and the prompt 'Reply with the single word OK.'; `error_max_turns` and `max_output_tokens` count as a working credential | Cheapest model, an alias that follows whatever Haiku the account can use, small input; a turn was answered | 2026-10-07 |
| D337 | AL-044: Identity format: login = `email (organization)`; API key = organization or email when Claude Code knows it, else null | The artboard row already uses ' · ' between fields | 2026-10-07 |
| D338 | AL-044: Reusable `apps/desktop/src/main/agent/claude-sdk.ts` (`createClaudeLauncher`, `claudeProcessEnv`, `loadClaudeQuery`, `ClaudeLaunchError`) loads the ESM-only SDK with a dynamic `import()` (kept in the CommonJS main bundle by electron-vite); exposed as `services.claude` for AL-100 | One launcher for checks and sessions | 2026-10-07 |
| D339 | AL-044: `ServiceOptions.claudeExecutable`, set from `AGENT_LANES_CLAUDE_EXECUTABLE` in `main/index.ts` only when `!app.isPackaged` | Lets e2e start the fake CLI instead of the real binary (same pattern as D247) | 2026-10-07 |
| D340 | AL-044: Test helper `apps/desktop/src/main/agent/testing/fake-claude.ts` (`createFakeClaude`, `fakeAssistant`, `fakeResult`, `fakeErrorResult`) is a scriptable stand-in for the SDK's `query()` that records options, env, sent messages and close | Other tickets can reuse it | 2026-10-07 |
| D341 | AL-044: The e2e fake (`e2e/fixtures/fake-claude-code.mjs`) speaks the SDK 0.3.292 stream-json control protocol and is run by the real SDK through `node`; its logs record only whether a key was accepted, never the key; the spec checks the fake's identity before any prompt is sent | The real SDK runs in e2e without touching an account, and a misconfigured run cannot prompt the real binary | 2026-10-07 |
| D342 | AL-043: The tester runs connectionData first (a refused token fails the test), then the projects list (`_apis/projects`, wellFormed, continuation-token paging, sorted names), then the three probes in parallel | The Build probe can run inside a project | 2026-10-07 |
| D343 | AL-043: Probes run in the default project when the token can see it, otherwise in the first project listed, otherwise at org level | Builds are listed per project in REST 7.1, so the org-level Build probe may come back unverified | 2026-10-07 |
| D344 | AL-043: Probes: Work Items POST `{project}/_apis/wit/wiql?$top=1` with 'SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 0'; Code GET `_apis/git/repositories?$top=1`; Build GET `_apis/build/builds?$top=1`. Nothing is written to prove a write scope | Read-only checks | 2026-10-07 |
| D345 | AL-043: Probe results: 2xx granted; 401, 403 or a sign-in page (203 or HTML) missing; anything else (404, 5xx, timeout, network) `unverified`. Missing scopes don't fail the test: status stays ok and `missingScopes` lists them | Other answers prove nothing about scopes | 2026-10-07 |
| D346 | AL-043: New contract types `AdoScopeAccess` (read/write), `AdoScopeCheck` {scope, access, status: granted \| missing \| unverified}, `REQUIRED_ADO_SCOPE_ACCESS` (5 checks in chip order) and `missingScopesOf()`; `ConnectionTestResult` gains `scopes` (empty for Claude/MCP or a refused token) and `projects` (string[] or null) | Additions inside connections.schemas.ts only | 2026-10-07 |
| D347 | AL-043: `ConnectionSummary` is unchanged: per-access checks are stored only in connections.json (the ADO record gets `scopes`, default [] so older files still load); the row keeps showing `missingScopes` | Other branches' `ConnectionSummary` literals keep compiling after merge | 2026-10-07 |
| D348 | AL-043: `adoScopeOfRequest(method, url)` maps an API area to scope + access (wit/work → Work Items, git/policy → Code, build → Build; GET, WIQL and workitemsbatch are reads). `ConnectionsService.noteAdoResponse(id, logEntry)` takes ADO client log entries: a 2xx write marks write granted; a 403 or sign-in page marks the area missing and emits `connections:changed` once; a 401 is ignored (AL-048); updatedAt is not bumped and nothing is written when nothing changed | 'Map a later 403 to ADO_SCOPE_MISSING' (ado-client already returns that code for a 403) | 2026-10-07 |
| D349 | AL-043: Re-testing a saved connection replaces its stored checks, so write access goes back to 'verified on first write' | ADO lets a PAT's scopes change without changing the token, so an old write-missing mark could be stale | 2026-10-07 |
| D350 | AL-043: connectionData returning the anonymous identity (aaaaaaaa-…) is treated as ADO_UNAUTHORIZED; `CONNECTION_DATA_API_VERSION` moved into ado-client (`connection-test.ts`) and is re-exported by the main tester | Existing imports still work | 2026-10-07 |
| D351 | AL-043: Display helpers live in contracts (`connections.display.ts`, one export line): `formatAdoConnectionDetails`, `displayOrgUrl`, `formatTokenExpiry`, `tokenExpiryState` (TOKEN_EXPIRY_WARNING_DAYS = 7, local calendar day, the date counts as the last valid day, year left out within 183 days or in the same year), `adoScopeChips`, `ADO_SCOPE_LABELS`, `adoScopeRequirement` | Follows AL-064's `formatPullRequestActivity` precedent; Q10 default | 2026-10-07 |
| D352 | AL-043: AL-042's e2e (`connections.spec.ts`) now counts only authorized connectionData requests (still 3) | Each passing test now also makes project and probe requests to that fake | 2026-10-07 |
| D353 | AL-029: Modal is built on React Native's `Modal`, which react-native-web renders as role=dialog with aria-modal | Gives the focus trap, Esc for the topmost modal only and focus return to the opener without custom code | 2026-10-07 |
| D354 | AL-029: Clicking the backdrop never closes a modal; only the close button or Esc closes a non-blocking modal | A stray click cannot lose a half-filled form | 2026-10-07 |
| D355 | AL-029: A `blocking` modal has no close button, ignores Esc, and makes `onClose` optional in its props type | First-run Connections cannot be dismissed | 2026-10-07 |
| D356 | AL-029: New `overlay` token group (scrim colour, scrim blur, drop shadow) in `packages/tokens/src/overlay.ts` and `agent-lanes-tokens.css`, sampled from artboards 2 and 5; a test keeps the two in sync | CLAUDE.md puts values in packages/tokens | 2026-10-07 |
| D357 | AL-029: `Tabs` follows the WAI-ARIA tabs pattern with one Tab stop; selection follows arrow-key focus except on tabs marked `opensElsewhere` (the drill-in's Claude Design tab, shown with ↗) | Standard keyboard behaviour; a tab that opens elsewhere must not fire on arrow focus | 2026-10-07 |
| D358 | AL-029: A tab's status dot is decorative; its word is part of the tab's accessible name | Status never depends on colour alone | 2026-10-07 |
| D359 | AL-029: `TabPanel` helper and `tabId`/`tabPanelId` functions are exported to link tabs to their panels | Callers get correct aria-controls/aria-labelledby wiring | 2026-10-07 |
| D360 | AL-130: Build/run commands are detected again on every call, not cached; overrides live only in repo settings (`buildCommand`/`runCommand`) and nothing is written to disk | A new solution or script is picked up at once | 2026-10-07 |
| D361 | AL-130: `buildCommands.forRepo(repoPath, { dir })` takes an optional worktree dir | A ticket branch that changes the build files gets its own detected commands | 2026-10-07 |
| D362 | AL-130: Detection order is root `.sln`/`.slnx`, then root project files, then `package.json` scripts with the repo's package manager, then a solution one folder down. With several solutions the one with most projects wins, `.sln` before `.slnx`, then the shallower path; the run project is the best-ranked runnable project (WinExe/Exe/Web ahead of tests and libraries) | Picks the main app solution and a project that actually runs | 2026-10-07 |
| D363 | AL-130: Projects a solution lists outside the repo (`../` paths) are left out of run-target detection | A ticket worktree holds only the repo's own files | 2026-10-07 |
| D364 | AL-130: New `build:commands` invoke channel returns the resolved commands and where each came from (detected or override) | The renderer and AL-146 can show and edit them | 2026-10-07 |
| D365 | AL-045: An MCP server's error output reaches the row as `statusMessage` on the `connections:list` / `connections:save` summary | The Connections modal row is AL-046; the data path is tested over IPC | 2026-10-07 |
| D366 | AL-045: Built-in ADO MCP servers are never written to `connections.json`; they are rebuilt from the ADO connections on each list, marked `builtInFor`, use the org's PAT, cannot be replaced or removed on their own, and go when the org is removed | One source of truth per org; no stale copies | 2026-10-07 |
| D367 | AL-045: `McpConnectionSummary` and `ConnectionTestResult` carry `tools` (capped at `MCP_TOOLS_LIMIT` = 256, names 1–128 chars); a passing test keeps the list across restarts, a failing test drops it | The row can show tools without re-testing | 2026-10-07 |
| D368 | AL-045: On Windows `npx` is started through `cmd /c`, and the PAT and tokens are scrubbed from all test output | `npx` is a .cmd shim; secrets never reach the row | 2026-10-07 |
| D369 | AL-045: Tests use a local fake MCP server (`fake-mcp-server.mjs`) and a fake HTTP MCP endpoint; no real services are called | §7 rule 6 | 2026-10-07 |
| D370 | AL-065: The shared fake ADO organisation (`@agent-lanes/ado-client/testing`) also answers `GET _apis/projects` and the project-level `git/repositories` and `build/builds` requests | AL-043's connection test probes them; without them `connections:save`/`test` in e2e hit unhandled 501s | 2026-10-07 |
| D371 | AL-065: The org-level `_apis/build/builds` route stays unhandled on purpose | Keeps the test that an unhandled request returns 501 meaningful | 2026-10-07 |
| D372 | AL-141: The agent-ticket store is a vanilla Zustand store (`zustand/vanilla`) exposing named actions instead of `setState` | Every change is one commit and a no-op commits nothing, which keeps re-renders scoped | 2026-10-07 |
| D373 | AL-141: State is split into `byId` (Map) and `byLane` (id arrays ordered by stage entry time, then createdAt, then id) | Streaming output never changes a lane's array; only the changed ticket object is replaced | 2026-10-07 |
| D374 | AL-141: Only `agent:output` (batched per frame, one commit) and `build:queued` are handled now; the `event-handlers.ts` doc comment lists which store action AL-103, AL-104, AL-106, AL-107, AL-109, AL-131–133 and AL-181 wire | The other ticket event payloads are still bare `{ticketId, at}` envelopes | 2026-10-07 |
| D375 | AL-141: Needs-you reasons are a typed list (`approval`, `permission`, `qa-gap`), one per kind; `approval` is set only by the gate actions and cleared automatically when the ticket changes stage | One badge per reason; a stage change ends the gate | 2026-10-07 |
| D376 | AL-141: Events for ticket ids the board has not loaded are dropped; `load()` keeps live state for tickets still present and the board backfills from records | No phantom cards; reloads keep streaming state | 2026-10-07 |
| D377 | AL-141: The Profiler test uses `React.memo` stand-in card/lane components in `app/entrypoint` | The real card and lanes are AL-143/AL-144, and Vitest does not run the React Compiler | 2026-10-07 |
| D378 | AL-141: `fakeTicketRecord` added to renderer `shared/testing` | Renderer tests need valid AL-101 ticket records | 2026-10-07 |
| D379 | AL-083: The ticket branch is created with `--no-track` at the resolved commit, not tracking `origin/<base>` | A later plain `git push` of the ticket branch is not refused | 2026-10-07 |
| D380 | AL-083: If `git fetch` fails (offline, no origin, timeout, base not on origin) the branch starts from the local `<base>`, else a stale `origin/<base>`; the reason is logged and returned in `start.fetchError` | Launch still works offline and says why | 2026-10-07 |
| D381 | AL-083: Only a missing or empty folder counts as ours; anything else at the path is refused with `path-occupied`, and rollback deletes a folder only when its `.git` file points into this repo's worktrees directory | Never deletes a user's files | 2026-10-07 |
| D382 | AL-083: A new branch name must be unused by local branches, origin branches and every branch or sub-branch recorded on this repo's tickets, including ones since deleted from git | No two tickets ever share a branch (R8) | 2026-10-07 |
| D383 | AL-083: Ticket ids are unique across repos: a second ticket for the same work item is refused with `ticket-exists`, even in another repo | Closes the duplicate-id follow-up from batch 9 | 2026-10-07 |
| D384 | AL-083: Rollback retries `git worktree remove` (250 ms, then 1 s) for Windows file locks and deletes the branch only while it still points at the start commit and no worktree has it checked out; anything left is listed in `rollback.leftovers` | Failure leaves no half-created worktree or branch, without deleting work | 2026-10-07 |
| D385 | AL-083: Launches run one at a time per repo, and ticket ids are claimed under one lock across all repos | Concurrent launches cannot pick the same branch or folder | 2026-10-07 |
| D386 | AL-083: No IPC channel yet; AL-165 Launch calls `services.worktrees.create` | Launch owns the user flow | 2026-10-07 |
| D387 | AL-083: The no-ticket name test expects `nt-20261007-fix-the-login` | AL-082's 32-character limit | 2026-10-07 |
| D388 | AL-030: The `toast` event schema gains an optional `id` and up to 2 `actions` (`{label, intent}`); an intent is a discriminated union whose only member today is `navigate` to a router route | Main cannot send callbacks over IPC; AL-048 and AL-211 add intents | 2026-10-07 |
| D389 | AL-030: A toast raised again with the id of one already showing replaces it in place and restarts its timer | A failure that keeps happening shows only once | 2026-10-07 |
| D390 | AL-030: At most 4 toasts show; later ones wait in order behind an "N more notices" line | The stack never covers the board | 2026-10-07 |
| D391 | AL-030: The info auto-dismiss timer pauses while the pointer is over the toast or focus is inside it | Users can read it and use its buttons (accessibility) | 2026-10-07 |
| D392 | AL-030: Only error toasts use `role=alert` / `aria-live=assertive`; other tones use `role=status` / polite; a plain info toast with no actions has no Dismiss button | Errors interrupt, notices don't; an info toast closes itself | 2026-10-07 |
| D393 | AL-030: The e2e helper resends a toast by id until it appears | One cold-start run lost the first toast under load; id-based replace means a resend never adds a copy | 2026-10-07 |
| D394 | AL-132: `build:start({ ticketId })` settles when the build ends (ok or BUILD_FAILED) instead of returning a job id at once | The ticket asks for an ok-or-BUILD_FAILED result; the job id still reaches the renderer early through `build:queued` | 2026-10-07 |
| D395 | AL-132: New `build:finished` event carries the build result plus the envelope | The card and Live dock can show builds started from anywhere, including the agent (AL-112), without awaiting the invoke | 2026-10-07 |
| D396 | AL-132: `build:log` payload is `{ ticketId, at, jobId, kind, lines: [{ text, stream, level }] }`, batched about every 100 ms, at most 500 lines per batch and 4,000 characters per line (longer lines end in …), ANSI codes stripped | Bounded IPC traffic; the log tab filters by `kind` and colours by `level` | 2026-10-07 |
| D397 | AL-132: `TicketLastBuildSchema` gains an optional, nullable `firstError` diagnostic (optional, not defaulted) | Existing records and tests still parse unchanged | 2026-10-07 |
| D398 | AL-132: Builds run through the platform shell (`shell: true`) with NO_COLOR, FORCE_COLOR=0, DOTNET_NOLOGO, DOTNET_CLI_UI_LANGUAGE=en and MSBUILDTERMINALLOGGER=off | Detected commands and overrides are command lines; the env keeps the log parseable | 2026-10-07 |
| D399 | AL-132: The build outcome comes from the exit code (0 = succeeded); diagnostic counts are only reported. A missing worktree, unknown ticket or repo without a build command returns VALIDATION before anything is queued | Parsers can miss formats; the exit code is authoritative | 2026-10-07 |
| D400 | AL-132: Card text helpers live in `packages/contracts/src/domains/build.display.ts` (pure, like `connections.display.ts`) and shorten C# and TS "name not found" messages to "X not found" | Matches artboard 6; reusable by card, worktree panel and Live dock | 2026-10-07 |
| D401 | AL-132: `events.test` envelope loop no longer lists `build:log` and `run:status`; `EventHub.test`/`emit.test` send full or other payloads | Test-only edits forced by the new required payload fields | 2026-10-07 |
| D402 | AL-133: `run:status` payload is the full RunStatus (runId, state building/starting/running/stopping/stopped/failed, runKind, port, url, startedAt, stoppedAt, exitCode, message) plus the envelope; `ACTIVE_RUN_STATES` is exported | Every change is a full snapshot, so the renderer never merges partial updates | 2026-10-07 |
| D403 | AL-133: Build staleness is a git fingerprint (HEAD plus size and mtime of changed or untracked files) taken when the last successful build started, kept in memory per ticket; the first Run after an app restart always builds; ignored build output never counts | Cheap and correct enough; no stale binaries run | 2026-10-07 |
| D404 | AL-133: A detected `dotnet run` for a web project gets `-- --urls=http://localhost:<port>` appended; override command lines are never changed and get the port only through the environment | launchSettings `applicationUrl` beats ASPNETCORE_URLS; overrides are the user's own | 2026-10-07 |
| D405 | AL-133: Both ASPNETCORE_URLS and PORT are set for any run that gets a port (web projects, scripts, unclassified overrides) | Overrides don't say which toolchain they use | 2026-10-07 |
| D406 | AL-133: Only local hosts count as the run URL (localhost, 127.0.0.1, ::1; wildcards become localhost). Without a printed URL the port is probed every 500 ms; after 120 s with neither, the run counts as running without a URL | Reads ASP.NET, Vite, Next and generic output; never reports a remote URL | 2026-10-07 |
| D407 | AL-133: `run:openUrl({ ticketId })` opens only the URL main found for that ticket's running app (via `shell.openExternal`); the renderer never passes a URL | The renderer can't make main open arbitrary URLs | 2026-10-07 |
| D408 | AL-133: Run output goes to `build:log` with kind `run` and jobId = runId; a Run's build step goes through the queue as kind `run` | One log stream and one queue for builds and runs | 2026-10-07 |
| D409 | AL-133: A port allocator remembers ports handed to live runs and releases them when the run ends | Two Runs started at the same moment never get the same port | 2026-10-07 |
| D410 | AL-133: `run:start` on an already running ticket returns its current status; a failed build step returns BUILD_FAILED and starts nothing | Idempotent Run button; never run a broken build | 2026-10-07 |
| D411 | AL-134: A run ended by Stop or quit is `stopped` with exitCode null; an unexpected non-zero exit is `failed` with "The app exited with code N" | The card tells a user Stop from a crash | 2026-10-07 |
| D412 | AL-134: `BuildService.build` takes an optional AbortSignal that cancels its queue job; Stop on a building run uses it | No process starts after Stop | 2026-10-07 |
| D413 | AL-134: Quit waits at most 5 s for runs to die (as D100 for build jobs); `disposeServices` calls `runs.dispose()` before `buildQueue.dispose()`, then tickets | A stuck tree can't block quit | 2026-10-07 |
| D414 | AL-134: `killTree` uses `taskkill /PID <pid> /T /F` on Windows; elsewhere SIGTERM to the process group (commands spawn detached), then SIGKILL after 3 s. The POSIX path is covered only by unit tests with a fake `process.kill` | Only Windows was exercised for real on this machine | 2026-10-07 |
| D415 | AL-210: Boundary presets (`PageErrorBoundary`, `LaneErrorBoundary`, `TicketErrorBoundary`, `PanelErrorBoundary`) live in renderer `shared/ui/error-boundary/boundaries.tsx` on top of AL-214's `ErrorBoundary`/`ErrorFallback`; they fix the log names (`page:<route>`, `lane:<title>`, `card:<ticketId>`, `panel:<panel>:<ticketId>`) and the fallback wording | Pages, widgets and entities can all import them under FSD | 2026-10-07 |
| D416 | AL-210: A per-card `TicketErrorBoundary` sits inside the per-lane one | Design §12: one broken card must leave even its own lane working | 2026-10-07 |
| D417 | AL-210: The page boundary sits inside Suspense and is keyed by `routeToPath(route)` | Moving to another page or ticket gets a fresh boundary instead of the last page's fallback | 2026-10-07 |
| D418 | AL-210: Page fallback labels are "the board", "ticket #<id>" and "the Claude Design tab of #<id>" | Says what failed | 2026-10-07 |
| D419 | AL-210: No new e2e spec; no real card or panel UI can be made to throw in the built app without a test-only hook | Unit tests on stand-ins cover it until real cards/panels exist | 2026-10-07 |
| D420 | AL-143: New invoke channel `tickets:list` (request undefined, response `TicketRecord[]` via `TicketRecordListSchema`) with `createTicketsHandlers` in `main/tickets/handlers.ts` | The board shows records after a start; the smallest piece of AL-090/AL-165 the lanes needed | 2026-10-07 |
| D421 | AL-143: The lanes render the real `AgentTicketCard`, so AL-144 was committed before AL-143 | No throwaway stand-in card; reverting AL-144 alone breaks AL-143 | 2026-10-07 |
| D422 | AL-143: Any lane collapses by pressing its header (a button with `aria-expanded`); a collapsed lane becomes the same vertical strip as Done | Needs no chrome beyond the artboard | 2026-10-07 |
| D423 | AL-143: Empty-lane copy for lanes other than QA follows artboard 6's pattern (e.g. "Nothing in Code review · Tickets land here once implementing finishes.") | Artboard 6 only shows the QA copy | 2026-10-07 |
| D424 | AL-143: Lanes have a 196 px minimum width and the Done strip is 70 px; the row's minimum is `LANES_MIN_WIDTH` and it scrolls horizontally below that | Horizontal scroll below the min width | 2026-10-07 |
| D425 | AL-143: `App.test.tsx` uses a longer findBy/test timeout, as `AppRouter.test` already does | The heavier lazy board chunk made its first cold load flaky under the parallel suite | 2026-10-07 |
| D426 | AL-144: Renderer `shared/config/labels.ts` (`MODEL_LABELS`, `EFFORT_LABELS`, `LANE_LABELS`, `modelEffortLabel`) is the single place that writes model, effort and lane vocabulary on screen | Card, lanes, settings and the new-ticket modal all use the same words | 2026-10-07 |
| D427 | AL-144: Footer band priority: needs-you, then build failed, then switching; a failed build is hidden while a new build job runs | One band per card | 2026-10-07 |
| D428 | AL-144: Gate wording by stage: approve plan / changes / fixes / QA / PR; permission reads "Needs you · allow <tool>"; QA gap reads "Needs you · N gap(s)" | Matches artboard 6 | 2026-10-07 |
| D429 | AL-144: The ADO state is a prop (`adoState`), not read by the entity | It is TanStack Query server data (AL-066) | 2026-10-07 |
| D430 | AL-144: A model change reads "Opus → Sonnet · High" (the new effort); an effort-only change reads "Opus · XHigh → High" | Artboard 6 | 2026-10-07 |
| D431 | AL-144: PR open uses `formatPullRequestActivity` from contracts (D218) with progress passed / total checks; Merged shows "Merged into <base> · HH:MM" on a muted card with a green bar | Reuses the AL-064 formatter | 2026-10-07 |
| D432 | AL-145: The dock's feed is derived from changes to the agent ticket store, not a new event channel; tickets that only appear on load (records) add no event | Any event the store takes in appears in the dock with no extra wiring | 2026-10-07 |
| D433 | AL-145: New `shared/lib/use-frame-selector.ts` (`useFrameSelector`), a frame-throttled store subscription, with entity hooks `useLiveFeed` and `useLiveTicketCount` on top | At most one dock render per animation frame | 2026-10-07 |
| D434 | AL-145: Each ticket store gets one feed, created on first use by `ticketFeedOf(store)` and kept for the app's life | Events still arrive while the board page is not shown | 2026-10-07 |
| D435 | AL-146: Optional `adoWriteBack` on `RepoSettingsSchema` plus `repoAdoWriteBack(repo)`, where unset means on | Stored repos and other tests stay valid without a migration (D59) | 2026-10-07 |
| D436 | AL-146: The panel lives in `pages/board` (`ui/SettingsPanel.tsx`, `model/settings-draft.ts`), not a features slice | Steiger's insignificant-slice rule fails a feature only one page uses; move it to `features/` when a second page opens it | 2026-10-07 |
| D437 | AL-146: Default skills are a free-text field ("/code-review /cs-qa-wip", parsed and deduplicated) | Skill discovery (AL-114) has not landed; AL-162 can switch to chips | 2026-10-07 |
| D438 | AL-146: Renderer hook `useRepoCommands(repoPath)` for `build:commands` in `shared/api/build-commands.ts` | Shows the detected command under each blank override | 2026-10-07 |
| D439 | AL-146: Save sends one minimal `settings:update` patch of only what changed; when any repo changed, repos are sent whole (D64), keeping repos added or removed elsewhere while the panel was open | No lost updates from other writers | 2026-10-07 |
| D440 | AL-160: No `processes/new-ticket` slice: the app layer hosts the modal (`app/new-ticket/NewTicketHost`, like ToastHost) and pages open it through a `shared/model` store (`openNewTicket`, `closeNewTicket`, `useNewTicketOpen`) | Steiger's recommended config enables `fsd/no-processes`, and a feature referenced only by a process trips insignificant-slice | 2026-10-07 |
| D441 | AL-160: Launch is a prop (`onLaunch(request)`); until AL-165 the app host only raises an info toast ("Agent ticket is ready … nothing was started") | Launch is AL-165 | 2026-10-07 |
| D442 | AL-160: The shell includes simple Model/Effort segmented controls and the Sprint / Search / No ticket control; AL-161–AL-164 plug into marked slots and dispatch into the same reducer | Form and summary work end to end now | 2026-10-07 |
| D443 | AL-160: A description is required only for "No ticket"; otherwise a picked work item is required | Validation | 2026-10-07 |
| D444 | AL-160: Interim primary "New agent ticket" button in the skeleton board header | Until AL-142 builds the real header | 2026-10-07 |
| D445 | AL-085: Ready = worktree present, clean (untracked files count as dirty, ignored files don't), no conflicts, sub-agent not running and the sub-branch exists; a missing worktree or deleted branch is never ready | Nothing un-mergeable is offered | 2026-10-07 |
| D446 | AL-085: "Sub-agent finished" comes from an injectable `SubagentActivity.isRunning(ticketId, name)`, defaulting to `NO_SUBAGENTS_RUNNING` | The session manager (AL-100/AL-107) isn't merged yet | 2026-10-07 |
| D447 | AL-085: The renderer refreshes `['branches', ticketId]` on every `agent:subagent` event for the ticket; AppProviders registers `createBranchStatusEventHandlers(queryClient)` through a new `runningEventHub()` export in `app/entrypoint/EventHub.ts` | The event payload doesn't yet say whether the sub-agent completed (AL-107); avoids a second bridge subscription | 2026-10-07 |
| D448 | AL-085: A status read never fetches and uses AL-080 `status()`, which doesn't take index.lock | Status reads stay cheap and don't block other git work | 2026-10-07 |
| D449 | AL-087: Q1 follows the proposed default: merge locally and push. The optional "block until the PR is approved" setting isn't built | Adding a settings field would change SettingsSchema and other branches' settings fakes | 2026-10-07 |
| D450 | AL-087: QA passed = current stage is Create PR or Done, the ticket entered QA at some point, and every stage since the last QA entry is Create PR or Done | A ticket QA sent back has to go through QA again | 2026-10-07 |
| D451 | AL-087: The checkout with the base checked out must have no staged or unstaged changes (GIT_DIRTY `base-checkout-dirty`; untracked allowed); when no checkout has the base, the merge is built with `merge-tree --write-tree` / `commit-tree` | No working tree is touched unexpectedly | 2026-10-07 |
| D452 | AL-087: A conflict changes nothing (`merge --abort`, MERGE_CONFLICT with `details.files`); a local base diverged from origin is refused (`base-diverged`), never rewritten | Safe failure | 2026-10-07 |
| D453 | AL-087: A failed push keeps the local merge and returns INTERNAL `push-failed` without moving the card; rerunning sees the branch already merged and only pushes | Retry is idempotent | 2026-10-07 |
| D454 | AL-087: Merge commit message is "Merge branch '<ticket>' into <base>" followed by "Work item #id: title" | Traceability to ADO | 2026-10-07 |
| D455 | AL-087: Merges and archives in one repo share one keyed queue (`repoQueue` in services.ts) | They run one at a time per repo | 2026-10-07 |
| D456 | AL-088: "Unmerged" = ticket-branch commits not in the base, or sub-branch commits in neither the base nor the ticket branch; uncommitted changes in any worktree also need the second confirmation | Defines what the second confirmation protects | 2026-10-07 |
| D457 | AL-088: On a partial removal the record stays on the board (status `partial` with leftovers) and Archive can run again; unregistered or missing worktrees count as removed | Locked files and long paths on Windows | 2026-10-07 |
| D458 | AL-088: The Node rm fallback runs only in a folder whose .git points into this repo's worktrees, and only when the user confirmed discarding or the worktree is clean; the removal function is injectable | Never deletes an unrelated folder | 2026-10-07 |
| D459 | AL-088: Only branches already in the base are deleted (`deleteMergedBranches`); unmerged branches are always kept, even after `discardUnmerged` | No commit becomes unreachable | 2026-10-07 |
| D460 | AL-088: The archive list is a separate folder of `<id>-<archivedAt>.json` files at `<userData>/tickets-archive`, not a record field; `isWorktreeFolderOf` in worktree-git.ts is exported | TicketRecordSchema unchanged and ticket ids can be reused | 2026-10-07 |
| D461 | AL-089: Diffs start at the merge base and include uncommitted work while the worktree exists; if it is gone the branch tip is used and `includesUncommitted` is false | Changes that landed on the base meanwhile don't appear | 2026-10-07 |
| D462 | AL-089: Untracked files are listed as `untracked`; their diff is built in main as an all-added patch after a NUL-byte binary check and the 256 KiB cap, only for paths git reports untracked and inside the worktree | Covers new files safely | 2026-10-07 |
| D463 | AL-089: Requested paths must be relative and inside the worktree (VALIDATION `invalid-path`); git runs with `GIT_LITERAL_PATHSPECS=1` | No pathspec magic can be smuggled in | 2026-10-07 |
| D464 | AL-090: Start-up reconciliation is read-only; nothing is removed or rewritten except by Adopt or Ignore. Missing worktrees are reported in `missingWorktrees` in the query data, not the AgentTicket store type | Other branches' AgentTicket literals keep compiling | 2026-10-07 |
| D465 | AL-090: An adopted orphan becomes a Queued ticket with ado null, its branch name as title, the repo's base branch and settings defaults; detached worktrees, invalid or taken ids and non-orphans are refused with a VALIDATION reason | Predictable adoption | 2026-10-07 |
| D466 | AL-090: Repos come from settings plus any repo named in a record; a repo git can't read goes in `unreadableRepos` and its tickets are flagged missing only when their folders are gone | A temporarily unreadable repo doesn't flag every ticket | 2026-10-07 |
| D467 | AL-090: `e2e/reconcile.spec.ts` registers its repo by writing settings.json between launches | `settings:update` refuses new repos (D305 folder picker) | 2026-10-07 |
| D468 | AL-032: The gallery is a `gallery` route in `shared/routing`; the app gates it: `routeFromHash` ignores `#/gallery` and `pages.ts` swaps in null unless `__GALLERY__` is set | Rollup drops the page chunk in production (e2e checks there is no `page-gallery-*` chunk) | 2026-10-07 |
| D469 | AL-032: Build-time define `__GALLERY__ = command === 'serve' || mode === 'gallery'` in `electron.vite.config.ts`, declared in `env.d.ts`, true in the Vitest ui project | `pnpm dev` gets the gallery, production builds never do | 2026-10-07 |
| D470 | AL-032: e2e builds the gallery with `electron-vite build --mode gallery --outDir out-gallery` (git-ignored) and launches it as an app folder | `pnpm e2e` tests the production build, which has no gallery | 2026-10-07 |
| D471 | AL-032: The card states in the gallery are composed from primitives inside the gallery page | AL-144's card was not on the branch; swap in `AgentTicketCardView` later | 2026-10-07 |
| D472 | AL-032: A unit test checks that every capitalised `@agent-lanes/ui` export appears as a JSX tag in the gallery source | A new primitive must be added to the gallery | 2026-10-07 |
| D473 | AL-033: Adjusted pair: the merged (muted) card goes from opacity 0.75 (D32) to 0.95 plus `filter: grayscale(0.7)`, via tokens `mutedOpacity`/`mutedFilter` (TS and CSS, sync-tested) | At 0.75 its muted text, ok activity text and IdChip were about 3.1–3.3:1 (axe serious); grayscale keeps luminance | 2026-10-07 |
| D474 | AL-033: Documented contrast exemptions, kept in the test and asserted to stay below their minimum: switch-off track #CBD5E1 on white (D291), TextField 1 px line border, ADO/failed/merged progress fills on the line track, attention and neutral dots inside pills | Each state is also carried by words, position or a 3:1 focus ring | 2026-10-07 |
| D475 | AL-033: axe runs in AxeBuilder legacy mode | The default mode opens a second page, which Electron's Playwright context cannot do | 2026-10-07 |
| D476 | AL-033: Added devDependency `@axe-core/playwright` to `@agent-lanes/desktop` | axe checks in e2e | 2026-10-07 |
| D477 | AL-033: Contrast helpers (`contrastRatio`, `blendOver`, `parseHex`, `MIN_*`) are exported from `@agent-lanes/tokens` | Reuse | 2026-10-07 |
| D478 | AL-046: Feature slices are `features/ado-organisations`, `features/claude-sign-in` and `features/mcp-servers` (not `connect-ado`/`connect-claude`/`connect-mcp`) | Steiger's `fsd/repetitive-naming` fails on the repeated `connect` | 2026-10-07 |
| D479 | AL-046: Shared row, form, test and remove UI is in `entities/connection`; the modal composition is `app/connections`, the only place the three features are referenced | Steiger's insignificant-slice rule allows it | 2026-10-07 |
| D480 | AL-046: New toast intent `{ type: 'openConnections', connectionId? }` in `ToastIntentSchema`; ToastHost's intent context gains `openConnections` | The hook AL-048 needs for Reconnect | 2026-10-07 |
| D481 | AL-046: Modal open state (tab, reconnect target, blocking, request counter) is a vanilla Zustand store in `shared/model/connections-modal.ts` | It opens from app, pages and processes | 2026-10-07 |
| D482 | AL-046: Connection hooks are in `shared/api/connections.ts`; `connections:changed` invalidates the list through the app event hub, registered in AppProviders with the QueryClient | One subscription in `app/` | 2026-10-07 |
| D483 | AL-046: Every saved row has Test (re-test), Replace and Remove; Remove needs a second press | Design §8 gives each row Test connection; Remove deletes the token | 2026-10-07 |
| D484 | AL-046: Save connections saves every draft that passed its test, is disabled while any typed draft is untested, and closes the modal when not blocking | Test before save | 2026-10-07 |
| D485 | AL-046: The Claude login is detected automatically when the Claude tab is shown and nothing is saved; "Look again" repeats the check | The user asked by opening the tab (D332) | 2026-10-07 |
| D486 | AL-046: After a passing ADO test the first project the token can see fills Default project; editing project or expiry does not reset the test; a project the token can't see is shown as an error | The token test does not depend on them | 2026-10-07 |
| D487 | AL-046: The placeholder board header gains a Connections icon button (testID `open-connections`) | AL-142 builds the real header | 2026-10-07 |
| D488 | AL-047: Steiger's `fsd/no-processes` rule is off in `steiger.config.mjs` | Design §5 and AL-047 use the processes layer (`processes/first-run`) | 2026-10-07 |
| D489 | AL-047: The first-run gate checks that an ADO row and a Claude row exist, not their current status | Save requires a passed test; a token that fails later is AL-048's reconnect toast, not first run again | 2026-10-07 |
| D490 | AL-047: While connections and repos load the gate renders nothing; if either list fails to load the gate lets the board through | The board never takes clicks before first run decides, and a load error never traps the user | 2026-10-07 |
| D491 | AL-047: e2e bypass: with `AGENT_LANES_SKIP_FIRST_RUN=1` in an unpackaged app main loads `?firstRun=skip`; `playwright.config.ts` sets it for every spec and `first-run.spec.ts` removes it; the trusted-sender check compares paths only | Existing specs keep starting on the board | 2026-10-07 |
| D492 | AL-047: The placeholder board header shows the chosen repo as a pill (testID `board-repo`) | AL-142 replaces it with the Repo dropdown | 2026-10-07 |
| D493 | AL-047: `App.test.tsx` seeds a returning user (connections, repo, last repo); `toasts.spec.ts` moves the mouse away before its info-toast test | A Dismiss click left the pointer over the next toast, which pauses its timer | 2026-10-07 |
| D494 | AL-066: ADO query hooks and the `adoKeys` factory (`['ado', …]`) are in `shared/api/ado.ts`; `entities/ado-work-item` holds the model helpers and WorkItemChip | Sprints and pull requests aren't work-item entities | 2026-10-07 |
| D495 | AL-066: New event channel `app:window` (`{ at, visible }`), emitted by `main/app/window-visibility.ts` on minimise, restore, hide and show and mapped onto TanStack's focusManager | Under Playwright the page's `visibilityState` stayed `visible` when minimised | 2026-10-07 |
| D496 | AL-066: Polling is opt-in per query (`{ live: true }`: every 60 s, never in the background); other ADO queries refetch on focus only | Only the board polls | 2026-10-07 |
| D497 | AL-066: `connections:changed` also invalidates `adoKeys.all` | Adding, replacing or removing an organisation changes ADO results | 2026-10-07 |
| D498 | AL-066: WorkItemChip is shown on the ticket page and in the gallery | Steiger's insignificant-slice rule needs two references; first step toward AL-170's meta row | 2026-10-07 |
| D499 | AL-135: The Build log was built on TicketPage under a heading; at integration it moved into AL-170's Build log tab (D536) | AL-170 was not on the branch | 2026-10-07 |
| D500 | AL-135: Virtualisation is a small custom fixed-row-height list (ScrollView plus absolutely placed 20 px rows, 30 rows of overscan), not FlashList | No new dependency; fixed rows make the visible range arithmetic | 2026-10-07 |
| D501 | AL-135: One row per log line; long lines end in an ellipsis; Copy copies the whole log | Row heights stay fixed | 2026-10-07 |
| D502 | AL-135: A ticket's log keeps all build and run jobs in one stream with a header row per job ("Build · 14:02:05"), capped at 100,000 rows with the oldest dropped first ("older lines dropped") | Bounded memory | 2026-10-07 |
| D503 | AL-135: Warnings use the attention tone text (#92400E) on its amber band, errors the danger tone text on its red wash; the Next error target gets a red left bar | Log text keeps 4.5:1 (design §11) | 2026-10-07 |
| D504 | AL-135: Follow tail starts on; scrolling up turns it off, scrolling to the end turns it on, Next error turns it off. Next error continues from the last error it jumped to while that is in view, else from the top of the view, and wraps round | Predictable navigation | 2026-10-07 |
| D505 | AL-135: Copy uses `navigator.clipboard` through `shared/lib/clipboard` (web file plus native stub), not a new IPC channel | The main window's session already allows clipboard writes | 2026-10-07 |
| D506 | AL-135: `App.test.tsx` loads the three lazy page modules in `beforeAll` | The cold transform of the ticket page chunk outlasted findBy under the full suite | 2026-10-07 |
| D507 | AL-170: New channel `tickets:get {ticketId}` → `{ record | null }` | The drill-in needs fields only the record keeps (session id, stage history, sub-branches) | 2026-10-07 |
| D508 | AL-170: "Open in Azure DevOps ↗" uses `Linking.openURL` (window.open → OS browser) | No new channel | 2026-10-07 |
| D509 | AL-170: The stage stepper and the Agent / Worktree / Merge, Sub-agents and Sub-branches panels are read-only summaries | AL-171–AL-178 replace them with their interactive features | 2026-10-07 |
| D510 | AL-170: The tab bar is shared as `TicketTabBar` in `shared/ui/ticket-tabs`, with an in-memory per-ticket last-tab store in `shared/model/ticket-tabs.ts` | Drill-in and design tab can't import each other (FSD); returning from Claude Design lands on the last tab | 2026-10-07 |
| D511 | AL-170: `LANE_LABELS`, `modelEffortLabel` and `stageProgressLabel` were added to `entities/agent-ticket` | Board, drill-in and design tab spell them the same way | 2026-10-07 |
| D512 | AL-170: The session pill reads "Session <id> · <time since the first stage>", with no token count yet | Token usage is AL-113 | 2026-10-07 |
| D513 | AL-170: The tab bar sits above the output/side row, not inside the left column | The side column's top lines up with the output card | 2026-10-07 |
| D514 | AL-170: `router.spec.ts` seeds a ticket record and clicks the Claude Design tab; new shared e2e helper `e2e/support/ticket-records.ts` (`seedTicketRecords`, `e2eTicketRecord`) | The drill-in needs a record | 2026-10-07 |
| D515 | AL-192: New channel `design:reload {ticketId}` → `{found}` and `DesignViewService.reload()` (the current page if allowed, else the canvas URL) | The reload button | 2026-10-07 |
| D516 | AL-192: Pop-out opens the canvas in Claude in the OS browser (window.open → shell.openExternal), not a second Electron window | Doubles as "Open in Claude ↗"; no second window in the design partition | 2026-10-07 |
| D517 | AL-192: The canvas label reads "claude.ai/design · <ticket id> canvas" | The canvas name is unknown without a design session | 2026-10-07 |
| D518 | AL-192: View state lives in `shared/model/design-views.ts` with `designViewEventHandlers`, registered in `app/entrypoint/event-routes.ts` | One subscription in `app/` | 2026-10-07 |
| D519 | AL-192: Load failures show "Webview · couldn't load" (danger) and sign-in pages "Webview · sign-in needed" (attention) | The view can't tell a failed sign-in from one that has not happened yet | 2026-10-07 |
| D520 | AL-193: New channels `design:linkCanvas` and `design:unlinkCanvas` (→ TicketDesign) and `design:openCanvas {ticketId, bounds?}` (→ DesignViewState); main chooses the URL | Returning to the tab never reloads a live view (R11), while a new view opens on the saved page | 2026-10-07 |
| D521 | AL-193: Main's `DesignCanvasLinks` saves the last signed-in page inside the linked canvas in `design.lastViewUrl`, through the view service's new `onChange` option | A reopened canvas lands on the same artboard | 2026-10-07 |
| D522 | AL-193: `useDesignCanvasSlot` sits next to `useDesignViewSlot` (shared placeholder logic); the `useDesignViewSlot` API is unchanged | Reuse | 2026-10-07 |
| D523 | AL-193: Linking a different canvas clears `lastViewUrl` and closes the old view; unlinking clears both | No stale artboard | 2026-10-07 |
| D524 | AL-193: With `AGENT_LANES_DESIGN_TEST_ORIGIN` (unpackaged only, D247) canvas links still name https://claude.ai and the view loads the same path on the test origin; URLs are mapped back before saving | e2e stays off claude.ai | 2026-10-07 |
| D525 | AL-193: The link form does not take focus on open | Taking focus swallowed Alt+← history navigation (D162) | 2026-10-07 |
| D526 | AL-194: "Selections sync back" is dropped (D117); the in-app artboard checklist is the selection in both modes | No operation reads the canvas selection | 2026-10-07 |
| D527 | AL-194: The MCP-link fallback is offered for both `signed-out` and `load-failed` | The view can't tell a failed sign-in from one that has not happened yet | 2026-10-07 |
| D528 | AL-194: Embed mode is two custom radio option cards saved per ticket in `ui.embedModeByTicket`, not the SegmentedControl primitive | The artboard shows two-line option cards | 2026-10-07 |
| D529 | AL-195: Artboards are read by a one-off read-only Agent SDK query per read (`persistSession: false`, `settingSources: []`, tools ClaudeDesign or Artifact, read-only `canUseTool`, `maxTurns: 12`, claude-haiku-4-5, JSON-schema output, 2-minute timeout), returning `ok` / `no-canvas` / `unavailable` via `design:listArtboards` | Not AL-196's persistent design session; AL-196 may move reads onto it | 2026-10-07 |
| D530 | AL-195: Artboard ids are file paths in the canvas | A renamed artboard whose path stays keeps its check; one whose path changes is dropped | 2026-10-07 |
| D531 | AL-195: Contracts add `DesignArtboardSchema`, `DesignArtboardListSchema` and the `design:listArtboards` channel | Typed IPC | 2026-10-07 |
| D532 | AL-195: The selection is renderer memory only (`shared/model/artboard-selection.ts`, `getSelectedArtboards` for AL-197) | Not persisted | 2026-10-07 |
| D533 | AL-195: "Send N artboards to agent as spec" is shown disabled with its live count | AL-197 makes it work | 2026-10-07 |
| D534 | AL-195: The renderer query uses `refetchOnMount` and `refetchOnWindowFocus: 'always'`; the fake `claude` e2e fixture gained an optional `design` state, and the design-canvas and design-embed-mode specs start it | Refresh on design-tab focus without polling a model; no e2e launches the real `claude` | 2026-10-07 |
| D535 | Integration (AL-066, AL-170): AL-170's own `shared/api/work-item.ts` was dropped; the drill-in uses AL-066's `useWorkItem` (refetch on focus, no 60 s poll) without `org`, so main uses the first organisation | One `['ado','workItem',id]` query, and only the board polls (D496) | 2026-10-07 |
| D536 | Integration (AL-135, AL-170): The Build log renders in the drill-in's Build log tab with a fixed 560 px height, and AL-066's WorkItemChip shows in the ADO tab until AL-180 builds it | The virtual list needs a bounded height inside the page's ScrollView; WorkItemChip keeps its second reference | 2026-10-07 |
| D537 | Integration (AL-046): `connections:changed` handlers register with `runningEventHub()?.register(...)`, like AL-085's branch-status handlers, not `startEventHub()` | Tests that render AppProviders without a hub stay unsubscribed | 2026-10-07 |
| D538 | AL-100: The SDK options set `permissionMode: 'acceptEdits'` as a placeholder until AL-109 brings the full permission policy | Sessions can edit files in their worktree now; AL-109 owns the real policy | 2026-10-08 |
| D539 | AL-100: Hooks (AL-084) and the extra MCP servers (AL-108) come in through a per-session `extras` callback instead of being built in the session manager | Keeps the session manager free of those tickets' code | 2026-10-08 |
| D540 | AL-100: SDK model ids live in contracts as `SDK_MODEL_IDS` | Each model id is spelled in one place (D10) | 2026-10-08 |
| D541 | AL-100: Two `emit.test.ts` cases from main that used empty `agent:status` and `agent:gate` payloads now use `design:spec` and `agent:subagent`, which still have the plain envelope | `agent:status` and `agent:gate` now have real payload schemas | 2026-10-08 |
| D542 | AL-102: Each `agent:output` event carries a per-ticket `seq`; history read back from the saved session gets seq 0 or below | The backfill and the live stream merge by seq with no gap or duplicate | 2026-10-08 |
| D543 | AL-102: A finished `text` event replaces its streamed `text-delta` events in the transcript buffer | Keeps the 5,000-event buffer within capacity | 2026-10-08 |
| D544 | AL-103: A session starting moves a Queued ticket to Planning through the same stage service | Design §9 step 1; every stage move takes one path | 2026-10-08 |
| D545 | AL-103: Stage moves for one ticket run one at a time on a keyed queue | Two `set_stage` calls at once cannot both pass the transition check | 2026-10-08 |
| D546 | AL-104: Added `agent:setGate` and `agent:getGate` channels | Gates are editable per ticket from the drill-in, and a reloaded renderer can recover a gate that is still waiting | 2026-10-08 |
| D547 | AL-104: System lines such as "Plan approved by Kyle · moved to Implementing" use the OS user's first name | There is no user profile to take a name from | 2026-10-08 |
| D548 | AL-105: `agent:send` returns `held: true` when the session is paused | The composer can show that the message is queued until Resume | 2026-10-08 |
| D549 | AL-108: The branch merged `main` (AL-163/AL-164) before integration; its one conflict, two adjacent export lines in the renderer's `shared/api/index.ts`, kept both | Brought the branch up to date while the agent's worktree was blocked | 2026-10-08 |
| D550 | AL-196: The mid-turn criterion is tested with fakes: `thread.test.ts` runs the thread beside a lead session that is mid-turn, and e2e `design-thread.spec.ts` uses the fake `claude` binary | Tests must never use a real claude.ai account | 2026-10-08 |
| D551 | AL-196: Saved design-thread history is capped at `DESIGN_THREAD_HISTORY_MAX` messages and each message at `DESIGN_THREAD_TEXT_MAX` characters (`<userData>/design-threads/<ticketId>.json`) | The app-data JSON file cannot grow without limit | 2026-10-08 |
| D552 | AL-196: The design session uses Sonnet (`DESIGN_THREAD_MODEL`) and the claude.ai login | ClaudeDesign and Artifact cannot be reached with an API key (D115) | 2026-10-08 |
| D553 | AL-196: In webview mode the canvas's own Claude chat stays the thread (D120); the in-app panel is for MCP-link mode and for when the webview cannot sign in | As scoped after the AL-190 spike | 2026-10-08 |
| D554 | AL-211: SESSION_LOST → Reconnect opens the ticket's Output tab for now | There is no reconnect/resume channel yet (AL-110 is todo; `agent:resume` only lifts an AL-105 pause). AL-110 replaces `reconnectSession` in `renderer/app/toasts/recovery-environment.ts` | 2026-10-08 |
| D555 | AL-211: MERGE_CONFLICT opens the ticket's Diff tab and lists the conflicting files in the toast | There is no separate conflict view yet | 2026-10-08 |
| D556 | AL-211: Ticket recoveries fall back to Copy diagnostics when the error carries no ticket id; ADO recoveries take the connection id from the error details' `org` when the caller does not pass one | Every code still gets an action | 2026-10-08 |
| D557 | AL-211: The same error code for the same ticket or connection replaces the existing toast instead of stacking copies | Avoids a pile of identical toasts | 2026-10-08 |
| D558 | AL-225: The guide is written against the current app flows; its criterion stays open until a teammate follows it on a clean machine | That needs a real teammate, Azure DevOps org and Claude account | 2026-10-08 |
| D559 | AL-142: The "need you" pill opens a filtered view rather than scrolling | A filter also works when the amber cards sit in collapsed lanes | 2026-10-08 |
| D560 | AL-142: The Sprint menu choice is saved in UI prefs (`lastSprint`), and the New ticket modal reads the same sprint through `pickSprint` | Board and modal agree on the sprint | 2026-10-08 |
| D561 | AL-161: The AL-163 `ModelPicker` replaced the old `MODEL_OPTIONS` segmented control, and the sprint-named `sourceOptions()` replaced main's static `SOURCE_OPTIONS` placeholder in `NewTicketModal` | Resolved while the branch merged main (AL-163/AL-164) | 2026-10-08 |
| D562 | AL-173: Added the build-run card states to the gallery `CardStatesSheet` | So they can be checked against artboard 3 | 2026-10-08 |
| D563 | AL-180: Added a renderer hook in `shared/api/ado.ts` for the work item detail, comments and linked PR queries the tab needs, over existing ADO channels | No new channels needed | 2026-10-08 |
| D564 | AL-221: Extended the existing `temp-repo.ts` and `fake-claude.ts` instead of writing new factories; one import, `src/main/testing/index.ts` | As D177 asked | 2026-10-08 |
| D565 | AL-221: The build queue's kit test is a separate file (`build/build-queue.kit.test.ts`) on real git worktrees with a committed node build script; the in-memory build-service tests are unchanged | Keeps the fast tests fast | 2026-10-08 |
| D566 | AL-221: Added `fakeTurn(text)` (assistant reply plus a successful result) | A small helper for scripting live-session replies | 2026-10-08 |
| D567 | AL-048: An agent the user had paused before the 401 stays paused after a reconnect | A reconnect does not override the user's own pause | 2026-10-08 |
| D568 | AL-084: When a branch with the requested name exists, a free name is picked; an occupied folder blocks the spawn with a reason | A sub-agent must never fall back to editing the ticket worktree | 2026-10-08 |
| D569 | AL-086: Merging again while a conflict is still open is refused with reason `merge-in-progress` | Nothing past the conflict can be merged by a second press | 2026-10-08 |
| D570 | AL-086: `merge-sub-branches.spec.ts` uses `test.slow()` | Its dozen real git calls took over 60 s on a loaded machine | 2026-10-08 |
| D571 | AL-106: Added `agent:getModel` and an `agent:model` event channel; sub-agent messages never clear a pending switch | A renderer that reloads mid-switch can catch up | 2026-10-08 |
| D572 | AL-107: The Sub-agents panel itself is AL-177; this ticket provides the counts, `subagentCountsLabel` ("2 running · 1 done · 1 queued", zeros left out) and `agent:getSubagents` | Data first, panel with its own ticket | 2026-10-08 |
| D573 | AL-107: SDK pending, running/paused, completed and failed/killed/stopped map to Queued, Running, Done and Failed; shell and other non-agent tasks are ignored | The panel shows agents only | 2026-10-08 |
| D574 | AL-107: The tree is capped at 200 nodes per ticket, dropping the oldest finished ones first, and is in-memory per app run | Bounded memory | 2026-10-08 |
| D575 | AL-107: `forwardSubagentText` (nested transcript) was not wired | Optional in the scope | 2026-10-08 |
| D576 | AL-107: Branch status refreshes on a sub-agent's started and finished events only, not on progress events | Avoids a git call per progress frame | 2026-10-08 |
| D577 | AL-107: `emit.test.ts` uses `design:spec` as its sample plain-envelope channel | `agent:subagent` now has a full payload | 2026-10-08 |
| D578 | AL-213: The no-orphans criterion is checked with fakes: `closeAll` and session disposal unit tests, the run-job e2e for node, build queue disposal for dotnet | No real claude or dotnet binary in tests | 2026-10-08 |
| D579 | AL-213: Only sessions that are starting or mid-turn (`SessionManager.midTurn()`) make quit ask first; idle and paused sessions quit without asking | Those are saved and can be resumed | 2026-10-08 |
| D580 | AL-213: Window state is a versioned `window-state.json` in userData written through a temp file; a missing, damaged or unknown-version file, or a spot now off every screen, gives the default 1440 × 960 window centred | App-written JSON is allowed (R2, R5) | 2026-10-08 |
| D581 | AL-230: `allowedLanes` returns `Partial<Record<Lane, DropAction>>`; `refusedLanes` and `dragLock` were added | The UI shows refusal reasons ("No linked PR", "Assigned to MD", "Agent in Implementing", "Add repo") from the same code | 2026-10-08 |
| D582 | AL-230: A PR card has an optional `repoRegistered`; when false every lane refuses it with "Add repo" | TB§7 | 2026-10-08 |
| D583 | AL-230: A Code Review item is draggable by anyone if it has no local agent and has a linked PR; an item that already has an agent shows "Agent in …" in every case | TB§3 | 2026-10-08 |
| D584 | AL-230: A Testing item with no branch uses a worktree from main | The same fallback TB§3 gives In Progress items; the table is silent on Testing | 2026-10-08 |
| D585 | AL-230: The user is matched by ADO identity id, else by sign-in name ignoring case; the id comes from the token test | TB§6 Identity | 2026-10-08 |
| D586 | AL-230: `TEAM_BOARD_COLUMN_KINDS` lives in `contracts/src/drop-rules.ts` and AL-231's schemas import it | One source for the column kinds | 2026-10-08 |
| D587 | AL-231: The default team is the project's default team when the user is in it, else the first team from `$mine=true` | ADO has no API for "the team in your ADO profile" | 2026-10-08 |
| D588 | AL-231: The board's last column (Done/Closed) and its items are left out; unrecognised columns get kind `other`, and a column only items mention gets an `unknown:<name>` column | T1 lists no Done column | 2026-10-08 |
| D589 | AL-231: The board's own column names are shown, mapped to the app's kinds by incoming/outgoing column type, then by name patterns (fail, review, test/QA/UAT, progress/active, to do/new) | Works across processes and renamed columns | 2026-10-08 |
| D590 | AL-231: The column comes from the board's `WEF_…_Kanban.Column` field, falling back to `System.BoardColumn`; items are ordered by column then id, not backlog rank | Backlog-rank order can follow in AL-234 | 2026-10-08 |
| D591 | AL-231: `sprint` takes the sprint path or id; without it the board uses `pickSprint` (the current sprint) | Same default as the header | 2026-10-08 |
| D592 | AL-231: Azure DevOps Server support uses the client's existing api-version negotiation; a test runs the fake as server 6.0 | No separate code path | 2026-10-08 |
| D593 | AL-231: The shared fake work item store gained optional board and backlog fields (area, tags, points, priority, stack rank, parent, board column, relations) and `workitemsbatch` supports `$expand`; `createFakeTeamOrg` holds the artboard 08 data | Shared by the AL-231–AL-233 tests | 2026-10-08 |
| D594 | AL-232: "The team's repositories" means active PRs in the project whose author, a reviewer or the team itself is on the team | ADO has no team-to-repository mapping | 2026-10-08 |
| D595 | AL-232: Only threads with status `active` count; pending, fixed, wontFix, closed, byDesign, deleted and system-only threads do not | Matches what still needs an answer | 2026-10-08 |
| D596 | AL-232: If any thread read fails the whole call fails | Better than showing a wrong count | 2026-10-08 |
| D597 | AL-232: Registered repos' remotes come from `git config --get remote.origin.url` through a new `registeredRemotes` option on `createAdoService` | One added option in `services.ts` | 2026-10-08 |
| D598 | AL-233: The type filter uses backlog kinds (story/bug/task) mapped through the backlog configuration; the default includes all three | No process's type names are hard-coded; artboard 11 shows a Task row and filter | 2026-10-08 |
| D599 | AL-233: Closed and removed items are excluded by the states mapped to the Completed and Removed categories; "already in a sprint" means the iteration is not the team's backlog iteration (root when ADO returns an empty path) | Process-independent | 2026-10-08 |
| D600 | AL-233: Paging is on the flat backlog order and each page is grouped on its own, so a Feature can appear on two pages; the response carries `total` and the page count | Keeps paging server-side | 2026-10-08 |
| D601 | AL-233: Default page size 50, maximum 200 (one batch read); a query returns at most 5,000 ids | ADO batch and WIQL limits | 2026-10-08 |
| D602 | AL-142: At integration the header's MCP pill is AL-108's live `McpStatusPill` (the running sessions' servers, amber with names on hover) instead of AL-142's pill from the saved servers' last test; `mcpStatusOf` and its test were removed | Both branches built the same pill; AL-142's own comment said AL-108's live status would replace it | 2026-10-08 |
| D603 | AL-084: At integration the session extras compose through AL-108's `combineSessionExtras`, which now also merges SDK hooks per event; AL-084's `mergeSessionExtras` was dropped and its test moved to `combineSessionExtras` | One composition path for the stage server, MCP servers, permission policy, sub-agent worktree hooks and sub-agent tracking hooks | 2026-10-08 |
| D604 | AL-113: Cost appears only in the drill-in session pill's tooltip, never inline | Ticket scope: "cost (shown in a tooltip only)" | 2026-10-08 |
| D605 | AL-113: Token totals were checked against faked SDK result and assistant messages only, never a real Claude account | No real accounts in tests (§7); a manual check against a real session's `/cost` is a follow-up | 2026-10-08 |
| D606 | AL-114: The skills list is cached in memory per repo for the app's lifetime and refreshed only on request (`refresh: true`) | Opening the New ticket modal does not start a Claude Code session every time | 2026-10-08 |
| D607 | AL-115: Duplicate stage comments are prevented twice: an in-memory key per stage entry, plus a read of the work item's newest Agent Lanes comment before posting | Covers a resumed session and an app restart | 2026-10-08 |
| D608 | AL-115: Stage comments go out one at a time per work item, at least 5 s apart; waiting comments beyond the per-work-item limit are dropped oldest first; the off switch is the existing Settings › Repos `adoWriteBack` | A burst of moves keeps the newest stage; no new setting | 2026-10-08 |
| D609 | AL-162: The skill chips come from the board's repo (`ui.lastRepo`, else the first registered repo), the same repo AL-164's workspace preview uses | One repo per modal | 2026-10-08 |
| D610 | AL-162: A default skill from settings that the repo does not list still gets a chip | So the user can turn it off | 2026-10-08 |
| D611 | AL-162: The renderer has its own small HTML-to-text helper (`features/create-ticket/lib/quote.ts`) for the work item quote, cut at 4,000 characters like main's `plainText` | The renderer may not import main code | 2026-10-08 |
| D612 | AL-171: Gate actions are a new feature slice (`features/resolve-gate`); `useResolveGate` and `useSetGate` live in `entities/agent-ticket/api` beside merge-to-main | The card and the stepper share one action and one store entry | 2026-10-08 |
| D613 | AL-171: The agent ticket store gained `setGates()` (`withGates` in `ticket.ts`) so a gate toggle shows at once; turning off a waiting gate also clears it once main reports it released | Immediate feedback without waiting for an event | 2026-10-08 |
| D614 | AL-171: Artboard 3 shows no gate toggles, so each step pill gets a small chip after it ("Approval" with a lock, or "Auto"), with the switch role, its state in the text and `hitSlop` for the touch area | Accessible without relying on colour | 2026-10-08 |
| D615 | AL-171: On the board, Approve / Request changes sit under the card next to AL-109's permission prompt, not inside it | Buttons inside the card's pressable would nest interactive controls | 2026-10-08 |
| D616 | AL-171: The gate mutation hook mounts only while a gate is waiting | Cards without a gate need no extra QueryClient work | 2026-10-08 |
| D617 | AL-110: The watchdog counts a session lost after 10 minutes without output while running (`SESSION_WATCHDOG_MS`), suspended while a gate or permission request waits on the user | Long silent builds are not cut off | 2026-10-08 |
| D618 | AL-110: A session lost mid-turn gets a `RECOVERED_MESSAGE` user turn after the resume; one lost while idle is resumed silently | It carries on with the turn it lost | 2026-10-08 |
| D619 | AL-110: Automatic retry happens once per 10-minute window per ticket (`RETRY_WINDOW_MS`); a second loss inside it shows the toast instead | No retry loops | 2026-10-08 |
| D620 | AL-110: A lost session with no saved session id (died before init) goes straight to the toast, saying it cannot be resumed | Nothing to resume from | 2026-10-08 |
| D621 | AL-110: The earlier attempt's work was recovered from the stash entry "WIP on feature/b35-AL-108-to-112: 05bc70a" without changing the stash, and its `recovery.test.ts` prefer-const lint errors were fixed | The stash is now fully contained in the branch and can be dropped | 2026-10-08 |
| D622 | AL-111: A session counts against the per-repo cap while its `claude` process is live (starting, running, idle or paused) | An idle session still holds its process and context | 2026-10-08 |
| D623 | AL-111: `queued` added to `AGENT_SESSION_STATES`; `agent:getStatus` answers from the launch queue, so a queued ticket reads as queued over IPC and in `agent:status` | One status source for queued and live tickets | 2026-10-08 |
| D624 | AL-111: No `agent:start` channel added: AL-165 owns the launch flow and should call `services.launches.launch()`; until then only crash recovery and Start now use the queue | Avoids a second launch path | 2026-10-08 |
| D625 | AL-111: Start now (no artboard) is a small notice with a primary button on the drill-in under the permission prompt (`features/start-queued-agent`); none on the board card | Artboard 1's queued card has no button | 2026-10-08 |
| D626 | AL-111: The launch queue lives in memory: queued launches and their job description do not survive an app restart | The ticket record does not store the job description; AL-165 may persist it | 2026-10-08 |
| D627 | AL-111: Crash-recovery restarts (AL-110) go to the front of the queue when the repo is full, and the "continue" turn is sent once they start | A lost session should not wait behind new launches | 2026-10-08 |
| D628 | AL-111: The card shows "Waiting for a free slot" for any ticket whose record stage is `queued`, even after its session starts, until the agent calls `set_stage` | AL-143/AL-144 should drive it from session state | 2026-10-08 |
| D629 | AL-112: Every finished build is sent to the live session, successes and Run's build step included; only cancelled builds are skipped | The agent always has the latest result (design §10) | 2026-10-08 |
| D630 | AL-112: At most 10 errors are listed as `file(line,col): CODE: message` (`BUILD_CONTEXT_MAX_ERRORS`), then "First 10 of N errors"; warnings are counted, not listed | Keeps the message short | 2026-10-08 |
| D631 | AL-112: Nothing is sent when the ticket has no live session; a paused session holds the message until Resume; a throwing hook never fails the build | The result is already on the ticket record (AL-132) | 2026-10-08 |
| D632 | AL-112: The message tells the agent no reply is needed now and to rebuild to check the current state before fixing anything | The build may be stale by the next turn | 2026-10-08 |
| D633 | AL-110: At integration, both the `reconnectSession` toast intent and AL-211's SESSION_LOST recovery go through `createRecoveryEnvironment().reconnectSession`, which calls `agent:reconnect` and shows "Couldn't reconnect <id>" on failure; this replaces D554's Output-tab stand-in and AL-110's own helper in `ToastHost` | One Reconnect path for both toasts | 2026-10-08 |
| D634 | AL-175: The Output stream is a small custom windowing list (ScrollView with spacer views and measured variable row heights) in `entities/agent-output`, not FlashList | Follows D500 for the Build log, adds no dependency, and keeps rows in normal flow so text can be selected across rows | 2026-10-08 |
| D635 | AL-175: Sub-agent output (`parentToolUseId` set) is left out of the lead stream; a successful turn end draws no row, only a failed turn shows "Turn ended early" | Sub-agent output belongs under its node in the sub-agents tree (AL-107/AL-177) | 2026-10-08 |
| D636 | AL-181: The PR channels live in a new `pr` contracts domain (`pr:draft`, `pr:create`, `pr:get`, event `pr:status`; `pr.names.ts`/`pr.schemas.ts` plus one line each in the aggregators and `ipc/handlers.ts`) | tickets.* and ado.* handler factories stay unchanged | 2026-10-08 |
| D637 | AL-181: `TicketRecord` gains an optional `pullRequest` field (ref, org connection id, id, webUrl, status, openedAt, closedAt) without bumping `TICKET_RECORD_VERSION` | Older records still read | 2026-10-08 |
| D638 | AL-181: Repository and project come from `git remote get-url origin` parsed with `parseAdoGitRemote`, the ADO connection is matched by org URL; a non-Azure-Repos remote, no work item or a ticket not yet in Create PR gives a `blocked` reason in the draft instead of an error | The panel can explain why it cannot open a PR | 2026-10-08 |
| D639 | AL-181: The ticket branch is pushed with `git push --set-upstream origin refs/heads/<b>:refs/heads/<b>` before the PR is created; nothing is opened if the push fails | ADO needs the source branch on the remote | 2026-10-08 |
| D640 | AL-181: The Pull request panel lives in `pages/ticket` (api + ui segments), not `features/create-pull-request` | Steiger's insignificant-slice rule fails a feature only one page uses | 2026-10-08 |
| D641 | AL-181: An abandoned PR also moves the ticket to Done; its card reads "PR !n · abandoned" instead of "Merged into main". Open PRs are polled every 60 s and re-watched after a restart | The ticket's work is over either way | 2026-10-08 |
| D642 | AL-198: "Agent is watching this canvas" sits at the top of the design tab's side panel, not on the canvas as in artboard 4 | The canvas is a native WebContentsView drawn over the page and would hide any renderer element on it | 2026-10-08 |
| D643 | AL-198: `TicketDesignSpecSchema` gains optional `fetchedAt` (and `deliveredAt`, AL-197); `DesignSpecEventSchema` gains `version` and `change` (shipped / delivered / fetched / used); the DesignSpec schema lives in a new `design.specs.ts`. Spec files are app-written JSON at `<userData>/design-specs/<repoKey>/<ticketId>/v<N>.json` (D8) | Keeps `design.schemas.ts` lean, as D124 | 2026-10-08 |
| D644 | AL-198: The design-spec MCP tools are added only when the session extras get a `DesignSpecService`; their names (`DESIGN_SPEC_TOOLS`) are added to `allowedTools`, `STAGE_SERVER_TOOLS` unchanged | Stage tools stay as they were | 2026-10-08 |
| D645 | AL-197: The ship button keeps artboard 4's label "Send N artboards to agent as spec" (help text says it approves and ships), not the ticket's "Approve & ship N artboards to agent →" | Matches the artboard and the AL-195 unit and e2e tests | 2026-10-08 |
| D646 | AL-197: The renderer sends the picked artboards' id, name and size; main reads only their source through a read-only design session, and an unreadable artboard ships with source null | R11: ship works at any time | 2026-10-08 |
| D647 | AL-197: Ships of one ticket go through a keyed queue, so two clicks at once give v1 and v2; `approvedBy` is the OS user's first name (as AL-104); with no live session the spec is held and delivered first on the next `system/init`, and a paused session holds it until Resume | No duplicate versions; one approver source | 2026-10-08 |
| D648 | AL-199: The version diff is pure functions in contracts (`diffSpecArtboards` / `describeSpecDiff`) matching artboards by id; each opened version shows its diff against the version just before it, not a free choice of two | Simple and covers the common case | 2026-10-08 |
| D649 | AL-199: "Ship vN again" (`design:reshipSpec`) copies the stored snapshot (sources included) as the newest version instead of reading the canvas again, and records `reshipOf` so the agent message and Output line say "vN shipped again" | The re-shipped spec is exactly what was approved | 2026-10-08 |
| D650 | AL-172: The model and effort switchers show the requested (pending) values, so a pick sticks at once; the running value shows in the "Opus → Sonnet · XHigh" line beside the "Switching · next turn" badge | The pick is visible immediately, the badge says it has not applied yet | 2026-10-08 |
| D651 | AL-172: A refused `setModel`/`setEffort` puts the previous selection back in the store and raises an error toast | AL-106's hooks had no rollback | 2026-10-08 |
| D652 | AL-172: The switchers are disabled on a Done ticket with the reason shown | Nothing runs after Done | 2026-10-08 |
| D653 | AL-172: A presentational `ModelEffortControlsView` with Agent samples on the gallery's card-states sheet, mirroring `BuildRunControlsView` | Gallery coverage, and Steiger's insignificant-slice rule wants a second reference | 2026-10-08 |
| D654 | AL-174: The conflict view is a modal opened by a failed merge or by the Merge panel's "Merge stopped on conflicts · View" row, not an inline list | Keeps the three-panel row from stretching | 2026-10-08 |
| D655 | AL-174: After a reload the conflict view reads the conflicted files from `git:diff` (status `unmerged`); `useTicketDiff` in shared/api gained an optional `{ enabled }` argument | The conflict stays one press away after a restart | 2026-10-08 |
| D656 | AL-174: Merge worktree → main is disabled when the ticket branch has 0 commits ahead ("No commits to merge into main yet."), so main's `alreadyMerged` path is only reached with ahead > 0 | Nothing to merge is a reason, not an action | 2026-10-08 |
| D657 | AL-174: A main-merge MERGE_CONFLICT is shown in the confirm modal with its files and advice to bring the base in, without "Hand to lead agent" | Nothing is left in progress after a refused main merge | 2026-10-08 |
| D658 | AL-174: A presentational `MergeControlsView` with Ready / Dirty / Conflict samples in the gallery | Gallery coverage and Steiger's insignificant-slice rule | 2026-10-08 |
| D659 | AL-174: `merge-sub-branches.spec.ts`'s UI test waits 60 s for the conflict dialog (three real git merges) and, at integration, 30 s for `branches:status` to count the sub-branches | Real git under load from parallel agents took over 5 s | 2026-10-08 |
| D660 | AL-177: The stage a queued sub-agent waits for is derived in the renderer from its agent type (reviewer/code-reviewer/*-reviewer → Code review, qa/tester/*-tester → QA) | AL-107's node has no scheduled-stage field; a main-process field would make it exact | 2026-10-08 |
| D661 | AL-177: A queued read-only sub-agent shows "—" instead of "read-only" in the branch slot | Artboard 3 draws the queued reviewer that way | 2026-10-08 |
| D662 | AL-177: The sub-agent tree query refetches every 30 s so the lead agent's tokens stay current; `agent:subagent` events update the nodes in between. At integration the lead card prefers AL-113's live `agent:getUsage` lead tokens and falls back to the tree's | One "212k tokens" source when a session runs | 2026-10-08 |
| D663 | AL-177: The panel keeps the existing `Panel` `ErrorBoundary` (`panel:sub-agents-panel`) rather than `PanelErrorBoundary('subAgents')` | Equivalent behaviour; switching is optional for AL-210 | 2026-10-08 |
| D664 | AL-178: Sub-branch rows that are not Ready show a reason pill (Merged, Working, Uncommitted, Conflict, Missing, Nothing new); row logic lives in `pages/ticket/lib/sub-branch-rows.ts`; the panel falls back to the record's sub-branches until `branches:status` loads | The user sees why a branch is not Ready; only the drill-in uses it | 2026-10-08 |
| D665 | AL-234: A `widgets` FSD layer between pages and features in `eslint.config.mjs` (layers list, same-layer and deep-import rules); Steiger already supports it and `lint:probes` still pass | TB§6 and the ticket specify `widgets/team-board`; CLAUDE.md and design §5 should list it | 2026-10-08 |
| D666 | AL-234: `HeaderMenu` moved from `pages/board/ui` to `shared/ui/header-menu` with an optional `valueNote` ("· from your ADO profile") and a wider max width | The widget reuses the Repo/Sprint dropdown for its Team dropdown | 2026-10-08 |
| D667 | AL-234: "Me" is matched by the ADO connection's identity display name (or sign-in name), mapped to a sentinel id so AL-230's `dragLock`/`allowedLanes` work unchanged; Me keeps PRs you authored or review, Unassigned keeps PRs with no (non-group) reviewer | The renderer has no identity id; main should expose it (AL-236 needs it too) | 2026-10-08 |
| D668 | AL-234: The team board reads the agent board's sprint path only for the team that sprint belongs to; another team shows its own current sprint. At integration, with main's header Team menu (`lastTeam`), `BoardPage` passes `sprintTeamId` = the header's team instead of assuming the profile team | A sprint path the team lacks never errors | 2026-10-08 |
| D669 | AL-234: Backlog shows its total from `ado:backlog` (page size 1) and is disabled until AL-239 supplies `onOpenBacklog` | The popout is AL-239 | 2026-10-08 |
| D670 | AL-234: Team board hooks in `shared/api/team-board.ts` (`useTeamBoard`, `useActivePrs`, `useBacklogTotal`) with keys under `['ado']`; at integration its own `useTeams` was dropped for main's `useTeams` in `shared/api/ado.ts` (same `['ado','teams',scope]` key) | `connections:changed` refetches reach them; one hook per channel | 2026-10-08 |
| D671 | AL-234: Added `grip` (GripVertical) and `backlog` (List) glyphs to `packages/ui` Icon | Artboard 08 cards and Backlog button | 2026-10-08 |
| D672 | AL-234: e2e `startFakeAdoServer({ teamBoard: true })` layers `createFakeTeamOrg` over the fixture org with `FAKE_TEAM_PAT`; team routes answer first and a 501 falls through. `ado.spec.ts`'s Team menu test ignores the team board's team read, which the fixture org does not serve | Reuse the fixture org for everything but the team board | 2026-10-08 |
| D673 | AL-234: With no ADO organisation connected the widget says so with an Open Connections button; a failed board read shows the error with Retry | Clear empty and error states | 2026-10-08 |
| D674 | AL-165: New invoke channel `tickets:launch` (request: repo, workItem `{id,title}` or null, description, skills, model, effort, gates, worktreeName; response: `{record, status}`) | D386/D624 left Launch without a channel | 2026-10-08 |
| D675 | AL-165: Main reads the work item from ADO again for its project, org URL, description and acceptance criteria; the renderer sends only id and title | Nothing ADO-derived beyond id and title crosses IPC from the renderer | 2026-10-08 |
| D676 | AL-165: An empty job description on a work item launch gets a default job ("Work on #id as its description and acceptance criteria say…") | The session refuses an empty first turn | 2026-10-08 |
| D677 | AL-165: A session that can't start rolls back the worktree, the branch and the ticket record through a new `TicketWorktreeService.discard`, using undo plans kept in memory for tickets created this app run | A failed launch leaves nothing behind | 2026-10-08 |
| D678 | AL-165: VALIDATION refusals show only under the modal summary; other codes also raise the AL-211 recovery toast (Reconnect, Copy diagnostics). The new card gets the focus-ring outline for 6 s through a `launched-ticket` store in `shared/model` | Input mistakes stay in the modal; environment failures get a recovery | 2026-10-08 |
| D679 | AL-165: `new-ticket.spec.ts` now expects the real Launch outcome: with no repo, "Add a repo in Settings…"; with no Claude connection, the "Connect Claude…" refusal with nothing left behind. D626 still applies: queued launches and their job description are in memory only | Launch is real now | 2026-10-08 |
| D680 | AL-236: `AgentSessionStatusSchema` and `AGENT_SESSION_STATES` moved to `agent.status.ts` (exported from the index as before) | Avoids a tickets↔agent schema import cycle | 2026-10-08 |
| D681 | AL-236: The undo handle is called `undoId`, not "undo token" | The no-secret-fields contract test refuses any response field named `*token*` | 2026-10-08 |
| D682 | AL-236: `agent:launchFromAdo` request is `{org?, project?, source, lane, repo?, overrides?}`. A board-item source carries team, sprint and the column the board showed, so main reads that board again and can say "Moved to X — refreshed"; a PR is read again through `ado:activePrs` | The recheck needs the same view the user dropped from | 2026-10-08 |
| D683 | AL-236: "Assign to me" uses the `_apis/connectionData` identity, with its Account property as the sign-in name; "In Progress" is the first state in the type's InProgress category. The drop is not gated by Settings › ADO state transitions | T5 makes it the explicit, user-initiated change. Needs one manual check against a real org | 2026-10-08 |
| D684 | AL-236: PR tickets are `pr-<id>` (answer comments) and `pr-<id>-review`, `-review-2`, …, with `ado` null. The worktree service gained a `checkout` input (existing branch, or detached for a review); a rollback never deletes a branch that existed before | Several reviewers per PR; never lose a user's branch | 2026-10-08 |
| D685 | AL-236: `stage-service.sessionStarting` takes an optional `startLane` hook, so a drop's ticket enters Implementing, Code review or QA from Queued instead of Planning | Drops start in the lane they were dropped on | 2026-10-08 |
| D686 | AL-236: AL-115 stage comments still post on the Queued→lane move for work item tickets | They are the agent lifecycle, not the drop transaction (the zero-writes test covers the transaction) | 2026-10-08 |
| D687 | AL-236: Two drops of the same card run one after the other (keyed queue) | The second sees the first's changes | 2026-10-08 |
| D688 | AL-236: The fake team org gained connectionData, a project-scoped work item GET, a revision-guarded PATCH that moves the board column with the state, and `rev` on `FakeWorkItem`. The success summary says "moved to In Progress" for Agile's Active state and the raw state name for other processes | Tests the transaction end to end without a real org | 2026-10-08 |
| D689 | AL-237: Main allows a 2 s grace past the 10 s Undo window | An Undo pressed at 9.9 s still works when it arrives | 2026-10-08 |
| D690 | AL-237: "Before the first turn ends" is detected from the SDK `result` message. An irreversible step is a Bash `git push`, `az repos pr`, or an `mcp__*` tool whose name writes a comment or thread (create, add, reply, update, resolve, post, edit, delete); reads don't count | T8 drops Undo once the agent has changed something outside the machine | 2026-10-08 |
| D691 | AL-237: Main emits the replacement toast under the launch toast's id (`launch-from-ado:<ticket>`) with the steps to revert by hand; the renderer only drops Undo while its own toast still shows it | One toast per launch | 2026-10-08 |
| D692 | AL-237: Restoring is a guarded patch: if the item changed in ADO since the drop, Undo reports `adoRestored: false` and says to set it back by hand | Never overwrite someone else's change | 2026-10-08 |
| D693 | AL-238: The PR launch (first-turn payloads in `main/agent/pr-launch.ts`, the thread reader `listOpenThreads` in ado-client) lives in main, not a renderer `features/answer-pr-comments` slice | The thread payload needs ADO with the PAT; the renderer path is the same `useLaunchFromAdo` drop | 2026-10-08 |
| D694 | AL-238: "Read-only" for a review is a detached checkout at the PR's source commit plus first-turn instructions (change no files, commit nothing, push nothing); the AL-109 permission policy does not enforce it | Follow-up: deny edits and pushes for `pr-*-review` tickets in AL-109's policy | 2026-10-08 |
| D695 | AL-238: The fake team org's open threads carry `threadContext` (file and line) and comment authors; thread counts are unchanged | The first turn lists file and line | 2026-10-08 |
| D696 | AL-240: Implementing has two Settings rows ("answer-comments" for your own PR, "implementing" for items); a test checks every row against the drop rules' own defaults | TB§3 gives them different defaults | 2026-10-08 |
| D697 | AL-240: `dropDefaults` (contracts `settings.drops.ts`) is optional and saved whole (all five rows), like `agentPermissions`; unset means TB§3's defaults and a bad stored row is salvaged back to its default | Same pattern as other structured settings | 2026-10-08 |
| D698 | AL-240: The launch sheet's skills are a text field (like Settings › Default skills), not the New-ticket chips | Features can't import each other | 2026-10-08 |
| D699 | AL-240: The Steiger insignificant-slice override added in AL-236 for `features/launch-from-ado` is removed; `LaunchSheetHost` is mounted in `app/index.tsx` | The app now references the slice | 2026-10-08 |
| D700 | AL-176: `useSessionStatus`, `sessionStatusQueryKey` and `sessionStatusEventHandlers` moved from `features/start-queued-agent` to `shared/api/session-status.ts`; start-queued-agent re-exports them | The composer needs the session state and features cannot import each other | 2026-10-08 |
| D701 | AL-176: The composer is split into a wired `Composer` and a props-only `ComposerView`, shown in three gallery blocks (Running, Paused · 2 queued, No session) | Steiger fails a feature referenced from only one page | 2026-10-08 |
| D702 | AL-176: Ctrl+Enter is caught with `onKeyDownCapture` on a wrapper View | react-native-web's TextInput stops keydown from bubbling (RNW #612) | 2026-10-08 |
| D703 | AL-176: The message box is one line high to line up with the 44 px Pause and Send buttons (the artboard draws all three at about 56 px) | Button's inner surface is fixed at 44 px | 2026-10-08 |
| D704 | AL-176: Skill chips are drawn 34 px tall, as on the artboard, inside a 44 px press target | AL-033 target-size audit | 2026-10-08 |
| D705 | AL-176: Steer now is a toggle chip (role checkbox) at the right of the chip row and applies to one message; Apply model now is disabled unless a model or effort switch is pending on a live, unpaused session | Artboard 3; no-op actions stay disabled | 2026-10-08 |
| D706 | AL-176: The Output stream's fixed height went from 620 to 560 px | The stream and composer fit in the card | 2026-10-08 |
| D707 | AL-200: The Output stream already carried the design events from AL-197/AL-198, so nothing was added there | No duplicate rows | 2026-10-08 |
| D708 | AL-200: "Unread" design replies are tracked in renderer memory (`shared/model/design-thread-seen.ts`); replies written before the app started count as read; opening the design tab marks all read | No contracts change; follow-up: a per-ticket last-seen time in UiPrefs if it should survive a restart | 2026-10-08 |
| D709 | AL-200: `TicketTabBar` reads the thread with `useDesignThread(ticketId, !onDesignPage)` | On the design page it reuses the panel's cached copy instead of fetching twice | 2026-10-08 |
| D710 | AL-200: The card's Design pill sits under the title, not in the id row | "Design v3 not yet used" does not fit beside the id chip and ADO state on a 196 px card | 2026-10-08 |
| D711 | AL-212: The performance e2e asserts median frame < 20 ms, no renderer long task over 100 ms and input < 100 ms; it logs the average fps and the GPU stalls but does not assert on them | The stalls are in the GPU process's Present call, outside app code | 2026-10-08 |
| D712 | AL-212: The renderer is minified (`minify: 'esbuild'`) and node_modules are split by package into vendor-react, vendor-rnw, vendor-data and vendor chunks (`manualChunks`); any other package goes to `vendor`, so no vendor chunk imports app code (checked in e2e) | Entry chunk 1,828 kB → 215 kB | 2026-10-08 |
| D713 | AL-212: The New ticket and Connections modals were not lazy-loaded | AL-165 was editing them in parallel and the size target was already met; optional follow-up | 2026-10-08 |
| D714 | AL-212: No manual memo was added; rAF batching, selector isolation and the lazy design tab were already covered by AL-141/AL-175/AL-140 tests | The profiler found no renderer hot spot | 2026-10-08 |
| D715 | AL-222: The scope's "test-only env flag that production builds strip" is a main-process build-time define, `__TEST_HOOKS__` (electron.vite.config.ts), read through `src/main/test-hooks.ts`. It is true for dev, build, e2e and gallery builds and false for `--mode release`; `pnpm package` now runs `electron-vite build --mode release && electron-builder --win`, so the release bundle contains none of AGENT_LANES_SKIP_FIRST_RUN, AGENT_LANES_CLAUDE_EXECUTABLE or AGENT_LANES_DESIGN_TEST_ORIGIN. The `app.isPackaged` check stays as a second guard | Keeps the per-fake env variables every spec already uses instead of one new flag and rewriting ~50 specs | 2026-10-08 |
| D716 | AL-222: AGENT_LANES_USER_DATA_DIR is not a test hook and stays in every build | CLAUDE.md documents it as a profile switch and the packaged e2e uses it | 2026-10-08 |
| D717 | AL-222: The fake `claude` gains a `lead` script ({ turns: [{ match?, steps: [tool / commit / text] }] }) that calls the in-process `agent_lanes` server's tools through the Agent SDK's mcp_message control protocol and commits in its worktree; it only runs in sessions whose initialize request lists `agent_lanes`, and user turns are processed one at a time as the real CLI does | One fake instead of a second one; design and connection-test sessions behave as before | 2026-10-08 |
| D718 | AL-222: The golden path goes through Code review and QA and approves the default-gated Create PR step on the board card before merging | The merge then runs with QA passed (no 'Merge anyway') and a gate is approved in both places, the stepper and the card | 2026-10-08 |
| D719 | AL-222: `createBranchStatusEventHandlers` (shared/api/branches.ts) also invalidates ['branches', id] on `agent:status` idle and on `agent:stage` stage changes | Bug found by the golden path: with the 60 s staleTime, Merge worktree → main stayed disabled with 'The worktree has 1 uncommitted change' after the agent had committed | 2026-10-08 |
| D720 | AL-235: `DragToLaneProvider` takes an `onLaunch` prop shaped like AL-236's `useLaunchFromAdo` (`(drop: { source, lane }, { alt, action }) => Promise<result | null>`); BoardPage passes `useLaunchFromAdo()` | Same-layer features can't import each other; AL-236 was built in parallel. The integrator wired it on main when merging | 2026-10-08 |
| D721 | AL-235: Without `onLaunch`, a drop shows an info toast ("Agents can't start from the team board yet") and rolls back | Kept as the fallback for hosts that pass no launch (tests, a future Backlog popout) | 2026-10-08 |
| D722 | AL-235: The dnd-kit hooks and DndContext live in `*.web.ts(x)` files; the native fallbacks render the cards without drag, and the Send to lane menu still works | dnd-kit only works in the DOM | 2026-10-08 |
| D723 | AL-235: Enter does not pick a card up (on a resting card it opens Send to lane); Tab cancels a keyboard drag instead of dropping; arrows jump only between lanes that take the card, and refusing lanes are disabled drop targets | Keeps Enter for the menu TB§7 asks for and avoids accidental drops | 2026-10-08 |
| D724 | AL-235: A Code Review item with no linked PR can be picked up even though no lane takes it | The only way the Code review lane can say "No linked PR" as TB§3 describes | 2026-10-08 |
| D725 | AL-235: Lanes show a refusal reason only when it helps ("No linked PR", "No open comments", the PR author rule, "Add repo"); other refusals just fade the lane (opacity 0.45) | Avoids noise on lanes that never take the card | 2026-10-08 |
| D726 | AL-235: `GlassPanel` (packages/ui) gained an optional `ref` prop | A lane must be a drop target | 2026-10-08 |
| D727 | AL-235: BoardPage's body moved into a `BoardContent` component wrapped by `DragToLaneProvider` | No re-indenting of the existing page | 2026-10-08 |
| D728 | AL-235: Locked cards (someone else's item, or an agent already on it) stay plain list items, not tab stops; their lock is read out in the list item's label | Nothing to do with them from the keyboard | 2026-10-08 |
| D729 | AL-235: The keyboard e2e waits one task after Space before pressing an arrow | The keyboard sensor starts listening on a 0 ms timer; without the wait the parallel run was flaky | 2026-10-08 |
| D730 | AL-235: The Send to lane menu does not pass Alt (no launch sheet from the menu); pointer and keyboard drags do | Follow-up if wanted | 2026-10-08 |
| D731 | AL-239: `LaneDragCard` gained an optional `group` (one agent per member, launched one after another so main queues the extras), group titles ("Plan these", "Dragging 2 items — drop on Planning or Implementing"), `accessory` and `onClick` props, and a modifier that centres the drag preview on the pointer | Without the modifier, wide rows put the preview off-screen | 2026-10-08 |
| D732 | AL-239: Alt (the launch sheet) applies only to single-card drops; a group drop skips the sheet | Avoids opening one sheet per row | 2026-10-08 |
| D733 | AL-239: A backlog row's checkbox is a sibling of the drag handle inside the list item, not nested in it | No interactive control nests in another | 2026-10-08 |
| D734 | AL-239: The popout is a custom non-modal `role=dialog` layer, not the `packages/ui` Modal: no scrim or focus trap. Escape is a window-level listener, skipped during a drag (Escape cancels the drag) and inside menus or `aria-modal` dialogs | The lanes must stay visible and live under it | 2026-10-08 |
| D735 | AL-239: The popout starts at max(276 px, 42 % of the window height), not artboard 11's 276 px | The app's header and title are taller than the artboard's, and the lane headers should stay visible | 2026-10-08 |
| D736 | AL-239: Added a Tag menu and an "In a sprint" switch to the filter row; area and tag choices come from the loaded rows plus the current pick | The ticket asks for them; artboard 11 doesn't draw them | 2026-10-08 |
| D737 | AL-239: Pop out is a new invoke channel `app:popOutBacklog({team?})` → `{opened}` in the app domain (route `#/backlog`, a `backlogWindow` service, `createBacklogWindowHandlers` in `ipc/handlers.ts`). One popped-out window per team; Pop out again focuses it, and it closes with the main window. Native drag data carries only ids and titles (at most 50 rows) and main rechecks every row before launching | Tokens and ADO calls stay in main; the drag payload is untrusted | 2026-10-08 |
| D738 | AL-239: Keyboard users in the popped-out window can't drag to the main window's lanes (native drag is pointer-only); the in-page popout has the full keyboard path | Native HTML5 drag has no keyboard equivalent across windows | 2026-10-08 |
| D739 | AL-239: `SessionManager.start` refuses while disposing (test added) | During quit, stopping sessions freed a slot and the launch queue started a queued agent, so quit hung (found by the e2e) | 2026-10-08 |
| D740 | AL-239: `shared/api` gained `useBacklog` (infinite query, key `['ado','backlog',team,'pages',filters]`); the e2e fake server gained a `teamItems` option; `e2e/support/team-board-app.ts` sets up a registered repo whose origin points to a local bare repo via `url.<bare>.insteadOf`, plus the claude stand-in, shared by the AL-239, AL-241 and AL-223 specs | One harness for the team board e2e | 2026-10-08 |
| D741 | AL-239: The e2e backlog uses artboard 08 plus artboard 11 data; where ids collide (#71335 and some generated 714xx rows) the board's items win, so the backlog shows 45 items, not 48 | Fixture overlap | 2026-10-08 |
| D742 | AL-241: The Undo flow scripts the fake agent (the lead turn matching #71318 calls `set_stage` behind the plan gate), so its first turn doesn't end before Undo is pressed | Undo is only offered until the first turn ends | 2026-10-08 |
| D743 | AL-241: "No ADO writes" means the fake team org received no request other than GETs and the POSTed WIQL and `workitemsbatch` reads after the drop | Those POSTs are reads | 2026-10-08 |
| D744 | AL-241: Toasts sit over the board's right-hand columns at 1440 × 960, so the spec dismisses them, or moves the pointer off them and waits, before each drag | A toast under the pointer swallows the drop | 2026-10-08 |
| D745 | AL-220: The "ship design" area in the scope has no feature slice (it lives in `pages/design-tab`), so it isn't counted as a slice gap | Covered by the design-tab page tests | 2026-10-08 |
| D746 | AL-223: Artboards 06 and 07 are captured as viewport screenshots at their headings in the gallery build | `gallery.spec.ts`'s element screenshots of these sheets come out clipped (the card-states sheet is blank in its top half) | 2026-10-08 |
| D747 | AL-223: The comparison uses seeded and fake data, so live-data content (activity lines, progress, needs-you colours, Done count, canvas artboards) differs by design and isn't reported | Not a design difference | 2026-10-08 |
| D748 | AL-223 (integration): `visual-qa.spec.ts` holds #71318's first turn on the plan gate (as D742) and presses Undo after capturing artboard 10 | Under full-suite load the turn ended before the toast was checked; leaving it mid-turn would make quit ask first and hang the close | 2026-10-08 |
| D749 | AL-220 (integration): `build-queue.kit.test.ts` checks that the two builds never overlap and the later one waits as Queued at position 1, whichever joins first, with a 120 s timeout | Each build reads its git fingerprint before joining the queue, so the order flipped under load | 2026-10-08 |
| D750 | On-prem: sprints, backlog, active PRs and the team board always resolve a team in main (the request's, else the profile default from `ado:listTeams`, else the first team; cached 5 min) and never call the project-level iterations route | Azure DevOps Server answers `/{project}/_apis/work/teamsettings/iterations` with 404; only the team route works (Kyle's server, 2026-10-08) | 2026-10-08 |
| D751 | A Team menu in the board header sets `lastTeam` in the UI prefs (cleared sprint on change); `useBoardTeam`/`useBoardSprint` in shared/model are the single source for the board team. The Sprint menu groups Current, Upcoming and Past | Kyle asked to pick his team and past sprints; one shared hook keeps the header, New agent ticket modal and team board on the same team | 2026-10-08 |
| D752 | Plain http organisation URLs are accepted for Azure DevOps Server (refused for cloud hosts), with an unencrypted-token warning in Connections | Kyle's organisation is internal and has no TLS | 2026-10-08 |
| D753 | The ADO client negotiates `api-version` per organisation from the server's 400 replies (out-of-range ceiling, preview-only flag) | Azure DevOps Server 2020 supports REST 6.x only | 2026-10-08 |
| D754 | Stage comments to work items are opt-in per repo and off by default (`adoWriteBack ?? false`); a repo missing from Settings posts nothing | Kyle does not want "Agent Lanes · Planning"-style comments on his tickets (2026-10-09) | 2026-10-09 |
| D755 | Ticket agents may comment on their work item only to report a QA failure ("QA failed…", while in QA) or answer one ("QA fail answer…", after QA or when launched from Failed). Enforced in a pre-permission hook and `canUseTool`, also for `System.History` writes; refusals go to the output, never to Needs-you. New `fromFailed` flag on the ticket ADO ref | Kyle: "you can post QA fails or QA fail answers, nothing else superfluous" | 2026-10-09 |
| D756 | Ticket sessions run in Claude Code auto permission mode by default; Settings › Agent permissions offers Auto / Accept edits / Ask and applies to running sessions. Old settings that asked for every edit keep Ask | Kyle: agents kept asking for permission | 2026-10-09 |
| D757 | Work item type and state colours come from the server (`ado:workItemColors`, cached 30 min) and show as a type edge/bar and a state dot with words, on team board and agent cards; token colours are the fallback | Kyle asked for the ADO colours on the board | 2026-10-09 |
| D758 | The header is sticky; once scrolled past the agent lanes, a solid (not glass) strip pinned under the header shows lane counts and card chips, animates in 220 ms ease-out, and takes drops (pointer drops matched against live target positions; auto-scroll off while it shows) | Kyle asked for a sticky header and a collapsed agent board; glass made the strip unreadable over the team board | 2026-10-09 |

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
| Q11 | R11 "talk to the design section": Claude Design's own chat in the embedded canvas, an in-app design thread backed by a per-ticket design agent, or both? | AL-196 | Answered by AL-190 (D120): both, canvas chat in webview mode, in-app design thread in MCP-link mode |
| Q12 | What can Claude Design expose programmatically (artboard list, source, selection, chat)? | AL-190–AL-197 | Answered by spike AL-190 (D115–D118): files, source and previews through the ClaudeDesign tool; no selection or live-chat operations. Live operation list still to confirm with a real login |

---

## 6. Change log

| Date | Change |
|---|---|
| 2026-10-07 | Plan created from the design doc (rev 14) and its seven artboards. Added R11 (Kyle, hard requirement): design section usable at any stage, approve & ship design to the implementation agent at any time → epic E11 rewritten around it (AL-191, AL-196–AL-200). |
| 2026-10-07 | Environment prepared: pnpm/Turborepo monorepo, electron-vite 5 + Electron 44, React 19 + react-native-web 0.21 + React Compiler, typed IPC with zod, tokens package, GlassPanel, ESLint + Steiger, Vitest (45 tests), Playwright smoke e2e (3 tests, isolated profile). Done: AL-001–AL-006, AL-009–AL-011, AL-013, AL-014, AL-020, AL-022. AL-007 in progress (config only). |
| 2026-10-07 | Repo pushed to github.com/KyleRichards94/ClaudeLanes. Prepared for the parallel build: IPC contracts and main handlers split per domain (D19), composition root `src/main/services.ts`, quit waits for `disposeServices`. Q6 answered (GitHub Actions, D17); Q9 built with the default (D18); AL-008 and AL-109 unblocked. Rules in §7. |
| 2026-10-07 | Integrator batch 1: merged AL-040 (partial: the reconnect prompt waits for AL-042/AL-047). Decisions D20–D28. `pnpm verify` green (107 unit tests), e2e 4/4. |
| 2026-10-07 | Integrator batch 2: merged AL-028, AL-012, AL-008, AL-031 (done) and AL-021 (partial: OFL licences in the packaged app not yet confirmed, waits for AL-007). Two registration conflicts resolved by keeping both sides (`services.ts`: `secrets` + `emit`; `packages/ui/src/index.ts`). Lockfile unchanged after `pnpm install`. Decisions D29–D55. `pnpm verify` green (251 unit tests), lint probes 9/9, e2e 13/13. |
| 2026-10-07 | Integrator batch 3: merged AL-041 and AL-060 (done). Registration conflicts resolved by keeping both sides (`services.ts`: `secrets` + `emit` + `settings`; renderer `shared/api/index.ts` and `shared/testing/index.ts`); lockfile regenerated (adds electron-store). Decisions D56–D81. `pnpm verify` green (437 unit tests), e2e 17/17. |
| 2026-10-07 | Integrator batch 4: merged AL-082 and AL-131 (done), AL-007 (partial: `pnpm package`, install and uninstall not run because drive C: was full; icon, pinned Electron, SDK binary resolver, NSIS include and packaged e2e specs are in) and AL-190 (partial: real claude.ai sign-in in the view and the live ClaudeDesign operation list need a manual check by Kyle). AL-131 conflicted with AL-012/AL-041 in `build.names.ts`, `build.schemas.ts`, `services.ts` and `ipc/handlers.ts` (kept both sides); AL-007's Vitest include merged with main's preload include. Integration fix: queue concurrency now reads `settings.buildQueueSize`, settings updates refresh the queue, `build:queued` is emitted, event contract test lists the channel. Lockfile unchanged after `pnpm install`. Decisions D82–D125; AL-190's scope updates written into AL-191–AL-197; Q11/Q12 answered. `pnpm verify` green (631 unit tests), e2e 22/22. Disk C: dropped below 50 MB during the run (typecheck hit an out-of-memory once). |
| 2026-10-07 | Integrator batch 5: merged AL-023, AL-061 and AL-015 (done). One registration conflict in the renderer's `shared/api/index.ts` (AL-041 settings exports + AL-015 event-handler exports, kept both sides). Lockfile unchanged after `pnpm install`. M0 now met except AL-007. Decisions D126–D158. `pnpm verify` green (728 unit tests), lint probes 12/12, e2e 25/25. |
| 2026-10-07 | Integrator batch 6: merged AL-140, AL-080 and AL-062 (done). AL-080 conflicted with AL-012/AL-041/AL-131 in `main/index.ts` and `services.ts` (kept both sides: `emit`, `settings`, `buildQueue` + `git`); AL-062 conflicted with AL-061 in `ado.schemas.ts` and `ado-client/src/index.ts` (kept both: sprint block, then work-item block above the channel contracts). Integration fix: AL-140's placeholder pages render text with AL-023's `Text` primitive (lint rule). Lockfile unchanged after `pnpm install`. D13 implemented (now dated). Decisions D159–D192. `pnpm verify` green (908 unit tests), e2e 31/31. AL-080's agent could not push its branch (Git Credential Manager account prompt); it was merged from the local branch. Drive C: had about 1.6 GB free. |
| 2026-10-07 | Integrator batch 7: merged AL-214 (done). Registration conflicts kept both sides: `services.ts` (`settings`, `buildQueue`, `git` + `log`, `diagnostics`), `ipc/handlers.ts` (settings, build + diagnostics), renderer `shared/api/index.ts` (settings/event-handler + diagnostics exports) and `main.tsx` (`startEventHub()` + `installErrorReporting()` and the `AppErrorRoot` wrapper). At merge, AL-214's follow-ups for AL-041 were applied: diagnostics read `settings.get()` and the settings service warns to the log. Integration fix: `ErrorFallback` renders text with AL-023's `Text` primitive (lint rule). Lockfile unchanged after `pnpm install`. Decisions D193–D206. `pnpm verify` green (1031 unit tests), e2e 34/34. Follow-ups: AL-210 reuses `ErrorBoundary`/`ErrorFallback`; swap `ActionButton` for AL-024's Button; later services take `services.log.child('<scope>')`. |
| 2026-10-07 | Integrator batch 8: merged AL-042 and AL-191 (done), AL-063 (partial: "visible in ADO" needs one manual check against a real org) and AL-064 (partial: card text and move to Done wait for AL-065/AL-144/AL-181; data side done). Registration conflicts kept both sides: `ado-client/src/index.ts` (AL-061/062 sprint and work-item exports + AL-064 PRs + AL-063 write-back), `contracts/src/index.ts` (`ado.pull-requests` + `ado.write-back`), `services.ts` (`git`, `log`, `diagnostics` + `connections` + `designView`), `ipc/handlers.ts` (build, diagnostics + connections + design) and `main/index.ts` (AL-214 logger wiring + AL-191 `mainWindow`/`designTestOrigin` options). At merge the connections service's warnings go to `log.child('connections')`. Integration fix: AL-063/AL-064 DTOs use AL-062's `WorkItemIdSchema` (D219). Lockfile unchanged after `pnpm install`. Decisions D207–D252. `pnpm verify` green (1337 unit tests), e2e 44/44. Follow-ups: AL-065 registers `createWorkItemWriteBack` and the PR channels; AL-047 raises Reconnect for `needsReconnect` rows (closes AL-040). |
| 2026-10-07 | Integrator batch 9: merged AL-025 and AL-101 (done). AL-101 conflicted in `services.ts` (kept both sides: `git`, `log`, `diagnostics`, `connections`, `designView` + `tickets`; `disposeServices` flushes tickets after the build queue, then closes the design views). At merge the ticket store's warnings go to `log.child('tickets')` (AL-101 follow-up for AL-214). Integration fix: real-git `record-store.worktree.test.ts` gets the 60 s timeouts `src/main/git` uses, and `AppRouter.test.tsx` 30 s (its cold first import passed 5 s under the full suite). Lockfile unchanged after `pnpm install`. Decisions D253–D279. `pnpm verify` green (1506 unit tests), e2e 45/45. Follow-ups: live-dock "Live" pill needs a filled Pill variant; drill-in may want an `xs` Pill and larger IdChip; AL-021's fonts e2e can point at IdChip once AL-144 lands; AL-032's gallery can use `pillTones`/`badgeStatuses`; `tickets:*` IPC channels for AL-090/AL-141/AL-165; same work item in two repos gives a duplicate ticket id (AL-083/AL-161); AL-197 stores specs outside `<repoKey>/<ticketId>.json`; AL-088's archive list not built (`delete` exists for AL-083 rollback); AL-100/AL-110 call `services.tickets.flush(id)` for must-save values; `nameSubAgent` and `BuildJobSchema.ticketId` can reuse `TICKET_ID_PATTERN`/`TicketIdSchema`. |
| 2026-10-07 | Integrator batch 10: merged AL-026, AL-024 and AL-081 (done). Registration conflicts kept both sides: `packages/ui/src/index.ts` (AL-025 Pill/Badge/StatusBadge/IdChip + AL-026 SegmentedControl/Switch + AL-024 Button), `packages/tokens/src/index.ts` and `agent-lanes-tokens.css` (AL-026 `selection` + AL-024 `control` token groups, each its own `:root` block), `services.ts` (`git`, `log`, `diagnostics`, `connections`, `designView`, `tickets` + `repos`), `ipc/handlers.ts` (diagnostics, connections, design + repos) and renderer `shared/api/index.ts` (design-view and diagnostics exports + repos hooks). `pnpm-lock.yaml` took main's side and was regenerated (adds `@testing-library/user-event` to `packages/ui`). No integration fixes needed. Decisions D280–D317. `pnpm verify` green (1634 unit tests), e2e 47/47. Follow-ups: AL-032 gallery renders Button, SegmentedControl and Switch (plus real-Chromium keyboard e2e); AL-033 checks the Switch off-track contrast; AL-029 reuses `selection` tokens and `interaction(.web).ts`; AL-214's `ActionButton` (D206) and AL-140's plain Pressables (D165) can switch to Button; AL-142/AL-047 fall back when `ui.lastRepo` is gone and treat `rejected` like `cancelled`; AL-146 invalidates `['repos']` after editing `settings.repos`; `repos:remove` should guard repos with live tickets once AL-141 lands. |
| 2026-10-07 | Integrator batch 11: merged AL-027 (done). One registration conflict in `packages/ui/src/index.ts` (AL-025/AL-026/AL-024 exports + AL-027 TextField, kept both sides). Lockfile unchanged after `pnpm install`. Integration fix: `AppRouter.test.tsx` sets Testing Library's `asyncUtilTimeout` to 15 s, because under the full suite the lazy page chunk outlasted `findBy`'s 1 s default (the batch 9 fix raised only the Vitest test timeout). Decisions D318–D329. `pnpm verify` green (1662 unit tests), e2e 47/47. Follow-ups: AL-046 holds a `useRef<SecureTextFieldHandle>` for the PAT (`read()` for Test connection, `take()` for Save, `onSecretChange` to reset tested state, Test connection in `accessory`, ref `focus()` or `autoFocus` for a Reconnect toast); AL-032 gallery shows TextField's four variants plus error, help and disabled states (no in-app page renders TextField yet, so no e2e); AL-033 checks the `line` border (#E2E8F0 on white, about 1.2:1, below WCAG 1.4.11's 3:1). |
| 2026-10-07 | Integrator batch 12: merged AL-044 and AL-043 (both partial: data paths done and proven through IPC in unit and e2e tests; the Claude tab, saved ADO row, scope chips and expiry input are AL-046, and each needs a manual check by Kyle against a real Claude Code login / ADO org). Registration conflicts kept both sides: `services.ts` (`tickets`, `repos` + `claude`), `contracts/src/index.ts` (`connections.claude` + `connections.display`) and `connections/service.ts` (`detectClaudeLogin` + `noteAdoResponse` in the interface and the service object). Lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D330–D352. `pnpm verify` green (1787 unit tests), e2e 53/53. Follow-ups: AL-046 builds the Claude tab on `connections:detectClaude` ("Use my Claude Code login", render `claudeConnectionStatusLine`, red while status is error) and the ADO row/chips/expiry with `formatAdoConnectionDetails`, `tokenExpiryState`, `adoScopeChips(result.scopes)`, the Default project dropdown from `result.projects` (free text when null) and an optional expiry date input; AL-065 passes `log: (entry) => void services.connections.noteAdoResponse(orgId, entry)` to the per-org ADO client; AL-100 starts sessions with `services.claude.launch({ credential, ... })` or `claudeProcessEnv`, not `process.env` + `sessionEnv()` (an inherited ANTHROPIC_API_KEY would override the login), and may unify the test model with D10; AL-048 tells a refused write (ADO may answer 401 TF400813) from a revoked token; AL-047/AL-048 own any near-expiry toast; re-run `e2e/claude-connection.spec.ts` on an Agent SDK upgrade (fake follows 0.3.292). |
| 2026-10-07 | Integrator batch 13: merged AL-029 (done). No conflicts; lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D353–D359. `pnpm verify` green (1837 unit tests), e2e 53/53. Follow-ups: AL-032 gallery shows Modal (normal and blocking) and Tabs (status dots and the ↗ tab); AL-046, AL-135, AL-146 and AL-160 can now build on Modal/Tabs. |
| 2026-10-07 | Integrator batch 14: merged AL-130 (done) and AL-045 (partial: the MCP error output is the row's `statusMessage`, proven over IPC; the row that draws it is AL-046). No conflicts; lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D360–D369. `pnpm verify` green (1948 unit tests), e2e 57/57 (the first run had one failure in `text.spec.ts` mouse selection, unrelated to these tickets; it passed 3/3 alone and the full rerun was green). Follow-ups: AL-146 adds the settings UI for `buildCommand`/`runCommand` overrides and shows the detected commands from `build:commands`; AL-131/AL-132 jobs get their command line from `buildCommands.forRepo(repoPath, { dir: worktree })`; AL-046 draws each MCP row's `statusMessage`, `tools` and `builtInFor` (no Remove on built-in servers); AL-108 reuses `adoMcpServerFor` (`connections/ado-mcp.ts`) and `sessionMcpServers({ adoConnectionId })`; leftover `agent-lanes-*` / `playwright-artifacts-*` folders in %TEMP% from parallel agents were not cleaned. Drive C: had about 8.8 GB free. |
| 2026-10-07 | Integrator batch 15: merged AL-065, AL-141, AL-083 and AL-030 (done). AL-030 conflicted with AL-141 in renderer `app/entrypoint/event-routes.ts` (`agentTicketEventHandlers` + `toastEventHandlers`) and with AL-029 in `packages/ui/src/index.ts` (Modal/Tabs + Toast); kept both sides. Lockfile unchanged after `pnpm install`. Integration fix: AdoService hands every ADO client log entry to `connections.noteAdoResponse(orgId, entry)` (the batch 12 follow-up for AL-065), with a unit test. Decisions D370–D393. `pnpm verify` green (2155 unit tests), e2e 62/62. The AL-065, AL-141 and AL-083 agents could not push their branches (Git Credential Manager prompt / remote rejected); they were merged from the local branches. Follow-ups: AL-066 builds the renderer queries on the `ado:*` channels; AL-165 calls `services.worktrees.create` and shows `details.reason` and `rollback.leftovers`; AL-088/AL-090 reuse `undoWorktreeAdd`, `findRegisteredWorktree` and `inspectPath` (`main/worktrees/worktree-git.ts`); AL-103/104/106/107/109/131–133/181 each add one line in `entities/agent-ticket/model/event-handlers.ts`; AL-090 calls `agentTickets.load(records)` and AL-165 `agentTickets.upsert(record)`; AL-048/AL-211 add toast intents to `ToastIntentSchema` and `app/toasts/toast-intents.ts`; `e2e/settings.spec.ts` AL-063 state-transitions test may be flaky under load (failed once in AL-030's run). |
| 2026-10-07 | Integrator batch 16: merged AL-133 and AL-134 (done) and AL-132 (partial: build data path done and proven in unit and e2e `build-job.spec.ts`; `buildCardState()` gives "Build failed · 3 errors" and the first error, but no agent card draws it until AL-160s). One registration conflict in `services.ts` (AL-065 `createAdoService` import + AL-133 `shell` import, kept both sides). Lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D394–D414. `pnpm verify` green (2229 unit tests), e2e 65/65. The first full test run had a Vitest fork crash on start-up (exit 0xC0000409) and the second timed out two `App.test.tsx` routing tests on `findBy`'s 1 s default under load from parallel agents (about 58 node processes); the file passed alone and the third full run was green. Follow-ups: AL-160s card renders `buildCardState(record.lastBuild)` and `runLabel(status)` and updates on `build:finished`/`run:status`; AL-173 Build/Run/Stop buttons call `build:start`/`run:start`/`run:stop`, show `lastBuildLabel()`, click opens `run:openUrl`, backfill with `run:list` after reload; AL-135 consumes `build:log` lines with `level`, filtered by `kind`; AL-112 uses the `build:finished` payload as next-turn context; AL-213 keeps the dispose order (runs, build queue, tickets); AL-146 could show which commands are overrides (no `--urls`); run the POSIX process-group kill on macOS/Linux CI; `App.test.tsx` may want the 15 s `asyncUtilTimeout` that `AppRouter.test.tsx` got in batch 11. |
| 2026-10-07 | Integrator batch 17: merged AL-210 (partial: page, lane, card and panel boundaries built and tested on stand-ins; every routed page is wrapped in `PageErrorBoundary` keyed by route; the card criterion stays open until real lanes and cards exist). No conflicts; lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D415–D419. `pnpm verify` green (2237 unit tests), e2e 65/65. AL-210's agent could not push its branch (Git Credential Manager prompt); it was merged from the local branch. Follow-ups: AL-143 wraps each lane in `LaneErrorBoundary` and AL-144 each `AgentTicketCard` in `TicketErrorBoundary` (keyed by ticket id), then tick AL-210's criterion against the real board; AL-175/AL-177/AL-192 wrap the output panel, sub-agents panel and design view host in `PanelErrorBoundary` (`output`/`subAgents`/`designView`); `React.lazy` caches a rejected chunk import, so Retry after a page chunk fails re-throws unless `pages.ts` recreates the lazy loader on reset. |
| 2026-10-07 | Integrator batch 18: merged AL-145 and AL-160 (done), AL-143 (partial: lanes, badges, Done strip, cards and dock match artboard 1 at 1440 × 960, but the cards' ADO state text waits for AL-066, live activity for AL-103, and the header and legend for AL-142), AL-144 (partial: every artboard 6 state built and tested through store actions; the gallery is AL-032 and most agent event payloads are not wired until AL-103/AL-104/AL-106/AL-107/AL-109/AL-132) and AL-146 (partial: every setting is editable; opening from the Repo dropdown waits for AL-142). One branch, no conflicts; lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D420–D444. `pnpm verify` green (2296 unit tests), e2e 70/70. Follow-ups: AL-066/AL-142 pass each card's `adoState`; AL-142 filters lanes by repo and sprint, replaces the skeleton header and the interim Settings / New agent ticket buttons, and opens Settings from the Repo dropdown; AL-090 reconciles records at start-up and AL-165 invalidates `['tickets']` after a launch, then highlights the new card; AL-210 wraps each lane in `LaneErrorBoundary` and each card in `TicketErrorBoundary`; AL-032 shows `AgentTicketCardView` per state; AL-115 respects `repoAdoWriteBack(repo)`; AL-111 reads per-repo `maxConcurrentAgents`; AL-114/AL-162 replace the default-skills text field with chips; AL-161–AL-164 fill the new-ticket modal's slots; AL-200 adds design presence to the card. |
| 2026-10-07 | Integrator batch 7 (b10): merged AL-085, AL-088 and AL-089 (done), AL-087 (partial: refuses a dirty worktree, merges --no-ff and pushes, record and store go to Done with "Merged into main · HH:MM"; showing it on the card waits for AL-144, the confirm modal for AL-174, the block-until-PR-approved setting for Q1) and AL-090 (partial: `tickets:board` reconciles records with `git worktree list`, Adopt/Ignore orphans, BoardSync loads the board at launch, e2e proves identical boards across restarts; cards drawing "Worktree missing" wait for AL-143/AL-144 and resuming sessions for AL-110). One branch; conflicts with AL-143 in `tickets.names.ts`/`tickets.schemas.ts`/`main/tickets/handlers.ts` (`tickets:list` kept beside the five new channels), `ipc/handlers.ts`, `shared/api/index.ts`, `entities/agent-ticket/index.ts` (kept both sides) and `App.test.tsx` (kept main's 15 s async timeout). Lockfile unchanged after `pnpm install`. Integration fix: `tickets/handlers.test.ts` passes stub archive/reconcile services to the merged `createTicketsHandlers`. Decisions D445–D467. `pnpm verify` green (2374 unit tests), e2e 71/71 on rerun (first run: `toasts.spec.ts` info toast auto-close timed out under load; passed 3/3 alone and in the full rerun). Follow-ups: the board now loads records twice (AL-143 `useBoardTickets` via `tickets:list` and AL-090 `BoardSync` via `tickets:board`, both `agentTickets.load`), so AL-142/AL-143 should switch the board to `useTicketBoard()` and drop one; AL-107 passes sub-agent tracking to `createBranchStatusService({ subagents })` and narrows the `agent:subagent` invalidation to completions; AL-174 needs IpcError to carry `details` for GIT_DIRTY/MERGE_CONFLICT file lists; AL-100/AL-213 stop the session before Archive; the Archive UI and archive list view have no owning ticket; AL-110 resumes sessions from records' sessionId; report `recordIssues` in the UI (AL-101); AL-178 and AL-179 build on `useBranchStatus` and `useTicketDiff`/`useDiffFile`. |
| 2026-10-07 | Integrator batch 8 (b9, b15, b13): merged AL-032, AL-033, AL-046, AL-047, AL-066, AL-135, AL-170 and AL-193 (done), AL-192 (partial: the design thread panel, shipping and the "Agent is watching" note wait for AL-196–AL-198), AL-194 (partial: shipping and the design thread wait for AL-196/AL-197, Design access status on the Connections Claude tab not built, MCP-link mode needs a real-account check by Kyle) and AL-195 (partial: the artboard listing needs a check against a real claude.ai Design canvas). Three branches. b9 conflicted in renderer wiring (`AppProviders.tsx`: branch-status + connections handlers both on `runningEventHub()`; `app/index.tsx`: FirstRunGate around AppRouter plus ConnectionsModal, NewTicketHost and BoardSync; `AppRouter.tsx`: PageErrorBoundary plus the gallery route and label; `shared/api`/`shared/model` index exports; `BoardPage.tsx` header: repo pill and Connections button beside Settings and New agent ticket; their tests kept both). b15 conflicted in `event-routes.ts`, `shared/lib/index.ts`, `App.test.tsx` and `TicketPage.tsx` (kept both). b13 conflicted with AL-088/AL-090/AL-143 in `tickets.names.ts`/`tickets.schemas.ts`/`main/tickets/handlers(.test).ts` (`tickets:get` added beside the six tickets channels), `ipc/handlers.ts`, `shared/api/tickets.ts` (`useTicketRecords` and `useTicketRecord`), the renderer index files and `event-routes.ts` (kept both); AL-170's `shared/api/work-item.ts` was dropped for AL-066's `useWorkItem`, and `TicketPage.tsx` took AL-170's frame with AL-135's BuildLog in the Build log tab and AL-066's WorkItemChip in the ADO tab. Lockfile from the branches (adds `@axe-core/playwright`); unchanged after `pnpm install`. Integration fix: the Build log gets a fixed 560 px height in the tab (its `flex: 1` let the virtual list draw all 50,001 rows inside the page ScrollView), and `build-log.spec.ts` opens the tab, scrolls the log into view and finishes the wheel trip if Chromium coalesced events. Decisions D468–D537. `pnpm verify` green (2562 unit tests; the first run hit a Vitest out-of-memory crash at start-up under load from parallel agents, the rerun was green), e2e 101/101. Drive C: had about 5.9 GB free. Follow-ups: AL-043/AL-044/AL-045 criteria that waited on AL-046's rows can be re-checked now (real ADO org and Claude account checks still need Kyle); AL-048 raises Reconnect with `{ type: 'openConnections', connectionId }` and the main-side toast for `needsReconnect` rows (closes AL-040); `e2e/packaged/packaged-app.spec.ts` will meet the first-run Connections modal on a fresh packaged profile (`pnpm e2e:packaged` not run); AL-142 replaces the `board-repo` pill and Connections/Settings buttons with the real header, keeps `ui.lastRepo` as the selection, and calls `useSprints`/`useWorkItems` with `{ live: true }`; the drill-in's `useWorkItem` should pass the ticket's ADO organisation once records carry an org id; AL-144/AL-032 swap the gallery's composed card samples for `AgentTicketCardView` and keep Card tone `muted` for merged cards; re-run the axe and target-size checks on the real board after AL-142–AL-145; AL-161 uses `useWorkItemSearch` with its own debounce, AL-180 `useWorkItem` (and replaces the ADO tab's WorkItemChip), AL-144/AL-181 `usePullRequest`; AL-171–AL-181 replace the drill-in's read-only stepper, panels and tab placeholders; AL-113 adds tokens to the session pill; AL-144/AL-200 open the design tab from the board card; AL-196 adds the design thread and refreshes artboards after each reply; AL-197 ships `getSelectedArtboards(ticketId)`; offer a canvas picker via ClaudeDesign `list_projects` once AL-196's session exists; Kyle runs the artboard listing against a real Design project and an artifact canvas; agent-lanes-tickets-* temp folders still pile up in %TEMP%. |
| 2026-10-08 | Integrator batch 1 (b11): merged AL-100 (partial: the packaged app was not run against a real Claude install), AL-102 (partial: tool rows covered by recorded-shape fake SDK messages only), AL-103 (partial: card move within one frame not measured with a live agent), AL-104 (partial: "no tokens while waiting" not measured against a real account) and AL-105 (partial: `/code-review` running the skill needs a real session). The branch also carried an AL-030 e2e fix (pointer moved off the toast stack). No conflicts; lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D538–D548. `pnpm verify`: typecheck, lint and build green; 2686/2687 unit tests passed in the full run, AL-085's `branch-status.test.ts` timed out under machine load (every git call slow while other agents' suites ran) and passed 10/10 when rerun alone. E2E: E2E_RESULT. |

| 2026-10-08 | Merged AL-100, AL-102, AL-103, AL-104, AL-105 (batch b11: session manager, output normalisation, stage protocol, gates, messages) as partial; open criteria need a real Claude session. Integration was interrupted by a pause for a Git upgrade (2.56.0) and finished by hand: `pnpm verify` green (2,687 tests), e2e 105/105 on rerun; 3 e2e tests failed once under load and passed on rerun, to be hardened under AL-220. |
| 2026-10-08 | Added epic E14 (AL-230–AL-241) from the add-on brief "Team Board & Drag-to-Agent" (Kyle, rev 27): team ADO board under the lanes, drag-to-agent with drop rules, Backlog popout, 10 s Undo; only To Do/Failed → Planning/Implementing changes ADO. Copy in `docs/design/DESIGN-team-board.md`, artboards 08–12. |
| 2026-10-08 | Merged AL-163, AL-164 (batch b16: model and effort pickers, workspace preview and stage gates), both done. The run that merged them stopped on a usage limit before recording them; verified by hand: `pnpm verify` green (2,705 tests), e2e 106/106 on rerun (one load-related flake on the first run, tracked under AL-220). |
| 2026-10-08 | Integrator batch 1 (b35): merged AL-108 (partial: ADO MCP server injected per work item org and the header MCP pill with auto-reconnect are in; reading and commenting on the work item needs a live session against a real ADO org) and AL-109 (partial: D18 policy, `canUseTool` "Needs you · permission" prompt and settings are in and unit-tested on the fake SDK; both criteria need a real Claude session). AL-110 (uncommitted, kept in the stash entry "WIP on feature/b35-AL-108-to-112: 05bc70a"), AL-111 and AL-112 were not on the branch and stay `todo`. No conflicts on main (the branch had already merged main); lockfile unchanged after `pnpm install`. No integration fixes needed. Decision D549. `pnpm verify`: typecheck, lint and build green; 2736/2738 unit tests in the full run, with load-related timeouts in real-git `ticket-worktree.test.ts` and `repos/registry.test.ts` (and `archive`, `merge-to-main`, `service.mcp` in an earlier run), none touched by this merge; each passed when rerun alone. E2E 106/106. The b35 worktree held a conflicted `sub-worktree.ts` and an untracked `subagent-tracker.ts` from another branch's stash; copies were saved before the worktree was removed. |
| 2026-10-08 | Integrator batch 2 (b24, b23, b39, b34, b38): merged AL-196, AL-211, AL-142, AL-161, AL-173, AL-179, AL-180, AL-221, AL-048, AL-086, AL-106, AL-107, AL-213, AL-230, AL-231, AL-232 and AL-233 (done), AL-225 (partial: the README guide is written, but no teammate has yet followed it end to end on a clean machine with a real org and Claude account) and AL-084 (partial: sub-branches are recorded with ahead counts; the Sub-branches panel is AL-178). Nothing rejected. Conflicts: b24 with AL-108/AL-109 in renderer `AppProviders.tsx` and `shared/api/index.ts` (kept both); b23 in `entities/agent-ticket/model/event-handlers(.test).ts` (kept AL-109 `agent:permission` + AL-173 `run:status`/`build:finished`) and `pages/board/ui/BoardPage.tsx` (took AL-142's header; AL-108's `McpStatusPill` moved into `BoardHeader`, D602); b34 in `agent.names.ts`/`agent.schemas.ts`, `agent/handlers(.test).ts`, `session-messages.test.ts`, renderer `ipc.ts` and `event-handlers(.test).ts` (kept both), `session-manager.ts` (SessionExtras keeps AL-109 `permissionMode`/`canUseTool` and AL-084 `hooks`) and `services.ts` (one `combineSessionExtras` path for stage, MCP, permissions, sub-worktree and sub-agent hooks, D603); b38 in `ado/service.ts`, `services.ts` (`onUnauthorized` + `registeredRemotes`) and `entities/agent-ticket/index.ts` (kept both). Lockfile unchanged after `pnpm install`. Integration fixes: `design/thread.test.ts`'s fake query implements AL-108's `mcpServerStatus`/`reconnectMcpServer`; `BoardPage.test.tsx` feeds the live MCP status. Decisions D550–D603. `pnpm verify` green (3049 unit tests). E2E: 115/116 in the first full run, the one failure a Playwright worker crash (0xC0000409) in `accessibility.spec.ts`, which passed 2/2 alone; the full rerun was 116/116. Follow-ups: AL-197 sends design-thread messages to the implementation agent on ship; AL-110 replaces `reconnectSession` in `renderer/app/toasts/recovery-environment.ts`; AL-177 renders the sub-agent tree from `agent:getSubagents` + `agent:subagent`; AL-178 renders recorded sub-branches; check ClaudeDesign tool names and `finalize_plan` against a real account; `e2e/first-run.spec.ts` "a fresh profile reaches the board…" is flaky under load (pick-repo dialog close, AL-220). |
| 2026-10-08 | Integrator batch 3 (b36, b49): merged AL-113, AL-115, AL-171 and AL-111 (done), AL-114 (partial: both skill sources listed through `supportedCommands()` needs a real Claude Code login), AL-162 (partial: the launch request carries the selected skills, but Launch goes to `launchNotReady` until AL-165), AL-110 (partial: tested with the fake SDK only; killing a real `claude` mid-run needs a real account) and AL-112 (partial: whether the model mentions the build errors needs a real session). Nothing rejected. Conflicts: b36 with AL-106/AL-107/AL-161/AL-195/AL-196/AL-213/AL-233 in `agent/handlers(.test).ts`, `session-messages.test.ts`, `session-manager.ts` (`midTurn` + `contextUsage`), `services.ts` (stage comments + sub-agents + merge sub-branches), `AppProviders.tsx`, `entities/agent-ticket/index.ts`, `NewTicketModal.tsx` (AL-161's `WorkItemPicker` and sprint menu + AL-162's prefill and skill chips; the picker's `workItem` dispatch now fires the prefill), `TicketPage.tsx`, the e2e fake `claude` (design `reply` + `commands`) and `agent.spec.ts` (kept both); b49 in `agent.names.ts`, `app.schemas.ts` (`recover` + `reconnectSession` intents), `agent/handlers(.test).ts`, `session-messages.test.ts`, `session-manager.ts`, `services.ts`, `AppProviders.tsx`, `TicketPage.tsx` (kept both) and `toast-intents.ts`/`ToastHost.tsx` (AL-211's recovery environment kept, D633). Lockfile unchanged after `pnpm install`. Integration fixes: `design/thread.test.ts`'s fake query implements `getContextUsage`/`supportedCommands`; Reconnect calls `agent:reconnect` from `recovery-environment.ts` and `recovery.test.tsx` checks it (D633). Decisions D604–D633. `pnpm verify` green (3109 unit tests). E2E: 114/118 in the first full run (`git.spec.ts` launch failure and three `logging.spec.ts` tests, all passing alone) and 117/118 in the second (`text.spec.ts` mouse selection, 3/3 alone), under load from other agents (about 46 node processes); the third full run was 118/118. Follow-ups: AL-165 calls `services.launches.launch({ ticketId, jobDescription, workItem })` and passes `NewTicketRequest.skills` into the launch; AL-088 calls `services.launches.cancel(ticketId)` on archive; AL-143/AL-144 drive the queued card from session state `queued` and may show "Session lost · Reconnect" and Start now on the card; AL-222 approves a real gate through the stepper; manual checks with a real account: token totals against `/cost`, skills from `.claude/skills`, crash resume, build errors in the next turn; the stash entry "WIP on feature/b35-AL-108-to-112: 05bc70a" is fully merged and can be dropped by Kyle. |
| 2026-10-08 | Integrator batch 4 (b37): merged AL-175, AL-198 and AL-199 (done), AL-181 (partial: the PR is created linked to the work item against the MSW fake ADO org; the push to a real Azure Repos remote, `workItemRefs` and the artifact link with real PAT scopes need a manual check by Kyle) and AL-197 (partial: delivery to the running session with priority `now` is proven with the fake SDK; that a real agent's next output names the spec version, and that shipping in Planning changes the plan, need a real Claude session). Nothing rejected. Conflicts kept both sides: `contracts/src/names.ts`/`schemas.ts` (AL-114 `skills` + AL-181 `pr` domain), `ipc/handlers.ts` (skills + pr handlers), renderer `AppProviders.tsx` (AL-113 `agent:usage` + AL-198 `design:spec` handlers) and `shared/api/index.ts` (`reconnectSession` + design-spec hooks); `services.ts` keeps AL-115's stage comments on `createStageService` and adds the PR, design-spec and design-ship services, with AL-198's `designSpecs` passed to AL-110's `stageSessionExtras` call; `TicketPage.tsx` imports both AL-171's `useSetGate` and AL-175's `OutputStream`. Lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D634–D649. `pnpm verify` green (3186 unit tests). E2E: 120/122 in the first full run, the failure the known `first-run.spec.ts` pick-repo dialog flake under load (AL-220; 2/2 alone), the full rerun 122/122. Follow-ups: AL-064's "PR !n · x / y checks" card text and move to Done are now rendered by AL-181 and can be re-checked; AL-192/AL-194's open notes about shipping and the "Agent is watching" note can be re-checked now AL-197/AL-198 are in; optionally post an ADO write-back comment when a PR opens or closes; consider hiding Merge worktree → main once a PR is open; optionally include `get_conversation` and a `render_preview` image in the spec; watch for a Playwright worker crash (0xC0000409) when `output-stream.spec.ts` runs right before `ticket-page.spec.ts` under load. |
| 2026-10-08 | Integrator batch 5 (b50): merged AL-172, AL-174, AL-177 and AL-178 (done) and AL-234 (partial: matches artboard 08 closely in the e2e screenshot and gallery sheet, but the pixel check is AL-223; Backlog stays disabled until AL-239 and cards are ordered by id, not backlog rank, D590). Nothing rejected. Conflicts with main's team-and-sprint picker (header Team menu, `useBoardSprint`/`useBoardTeam` moved to `shared/model`) and AL-113: `BoardHeader.tsx` (kept main's Team menu, imports `HeaderMenu` from its new `shared/ui/header-menu` home; main's section headings in `HeaderMenu` followed the move), `BoardPage.tsx` (main's `useBoardSprint` + AL-234's `TeamBoard`) and `TicketPanels.tsx` (AL-177's `LeadAgentCard`/tree, keeping AL-113's `leadTokens` prop from `agent:getUsage`, D662). Lockfile unchanged after `pnpm install`. Integration fixes: one `useTeams` hook (AL-234's duplicate in `shared/api/team-board.ts` removed for main's, same key); the team board takes `sprintTeamId` so the agent board's sprint is used only on the header's team (D668, unit test added); `ado.spec.ts`'s Team menu test ignores the team board's team read the fixture org cannot answer (D672); `text.spec.ts` waits for the board header to stop wrapping before its mouse drag (the header now wraps about 0.75 s after load at 1424 px since the Team menu was added; the test failed 2 of 6 runs with or without the team board); `merge-sub-branches.spec.ts` gives `branches:status` 30 s (D659). Decisions D650–D673. `pnpm verify` green (3272 unit tests). E2E: 125/128 in the second full run (`first-run.spec.ts` pick-repo flake, AL-220, and the Merge panel count under load, both 3/3 alone), then 128/128. The b50 agent could not push its branch (Git Credential Manager prompt); it was merged from the local branch. Follow-ups: the board header no longer fits one row at 1440 px with Repo, Team and Sprint menus (artboard 1; AL-223 or a header follow-up); the team board's own Team dropdown and the header's Team menu are two separate team choices, worth unifying (TB§2 vs main's `lastTeam`); AL-084's "Sub-branches appear in the Sub-branches panel" and AL-087's confirm-modal note can be re-checked now AL-178/AL-174 are in; AL-176 puts "Apply model now" in `features/change-model` (`useApplyModelNow` exists); Q1/AL-087 block-until-PR-approved is still open for Merge worktree → main; optionally swap the Sub-agents panel to `PanelErrorBoundary('subAgents')` and tick AL-210's panel item; a main-process "scheduled at stage" field would make "Starts at the … stage" exact; AL-235 adds drag and the keyboard "Send to lane" menu on the team board cards; AL-239 passes `onOpenBacklog` to `<TeamBoard>`; main should expose the signed-in ADO identity's id/uniqueName so "Me" is not matched by name (AL-236 needs it); order team board cards by backlog rank when `ado:teamBoard` provides it; list the `widgets` layer in CLAUDE.md and design §5. |
| 2026-10-08 | Integrator batch 6 (b51, b52): merged AL-165, AL-236, AL-237, AL-238, AL-240, AL-176 and AL-200 (done) and AL-212 (partial: the entry chunk is 215 kB and input latency is under 5 ms, but GPU-process Present stalls of 250–900 ms pull the average to 29–43 fps on this loaded machine; re-measure on an unloaded one). AL-162 set to done: AL-165's Launch passes the selected skills into the session's first turn. Nothing rejected. b51 merged cleanly; b52 conflicted with AL-172/AL-174 in `pages/gallery/ui/CardStatesSheet.tsx` (Agent and Merge panel samples + AL-176's Composer samples) and with main's team picker in `shared/model/index.ts` (`board-team` + `design-thread-seen` exports), both kept both sides. Lockfile unchanged after `pnpm install`. No integration fixes needed. Decisions D674–D714. `pnpm verify` green (3348 unit tests), e2e 138/138 on the first run. Neither agent could push its branch (Git Credential Manager waiting for an interactive sign-in); both were merged from the local branches. Follow-ups: AL-235 calls `useLaunchFromAdo()(drop, { alt: event.altKey, action })` for drag and keyboard drops, and AL-237's toast appears only once AL-235/AL-239 drop cards (AL-241 covers Undo end to end); manual check against a real org that `System.AssignedTo` accepts the connectionData Account value and Active lands in the team's In Progress column; tighten AL-109's permission policy for `pr-*-review` tickets so the read-only review is enforced; e2e with the fake `claude` binary sending while paused through Launch and Resume (AL-176); persist design-thread last-seen per ticket in UiPrefs if wanted (AL-200); optionally lazy-load NewTicketModal and ConnectionsModal (AL-212); make `build-queue.kit.test.ts` "runs one build at a time…" deterministic (start order flips under load, AL-220). |
| 2026-10-08 | Integrator batch 7 (b54): merged AL-222 (partial: the golden-path e2e passes locally, about 13 s for the spec and 139/139 for the suite in 3.7 min, but has not yet run in CI because the agent's branch push needed an interactive Git Credential Manager sign-in). Nothing rejected. Merged cleanly; lockfile unchanged after `pnpm install`; no integration fixes. Includes a real fix: branch status is refreshed when a turn ends or the stage changes, so the Merge panel no longer shows a change the agent has since committed. Decisions D715–D719. `pnpm verify` green (293 files, 3353 unit tests); `pnpm e2e` 139/139. Follow-ups: tick AL-222's CI criterion once CI has run on main; CLAUDE.md's command table could note that `pnpm package` builds with `--mode release`, which leaves out the e2e test hooks; AL-224 should keep `--mode release` in any release script it adds. |
| 2026-10-08 | Integrator batch 8 (b53): merged AL-235 (done). Clean merge; lockfile unchanged after `pnpm install`. Integration fix: BoardPage now passes AL-236's `useLaunchFromAdo()` to `DragToLaneProvider`, so a team board drop starts the agent. Decisions D720–D730. `pnpm verify` green (3382 unit tests), e2e 143/143 (a first run had one failure in `repos.spec.ts` "picking a non-git folder": the folder dialog was not parented because `BrowserWindow.getFocusedWindow()` was null under the parallel run; it passed 3/3 alone and the full rerun was green). |
| 2026-10-08 | Integrator batch 9 (b55): merged AL-220 (done), AL-239 (partial: artboards 11/12 match closely with deliberate differences D735–D736, sign-off at AL-223; a real mouse drag from the popped-out window to the main window across two monitors needs a manual try), AL-241 (partial: the six flows pass locally and in the full suite, not yet run in CI) and AL-223 (partial: all twelve artboards captured by `e2e/visual-qa.spec.ts` and compared; sign-off is Kyle's). Nothing rejected. Clean merge; lockfile unchanged after `pnpm install`. Integration fixes: `build-queue.kit.test.ts` no longer depends on which build joins the queue first (D749; it failed the first `pnpm verify`); `visual-qa.spec.ts` holds #71318 on the plan gate and undoes the launch after capturing artboard 10 (D748; it failed the first e2e run). Decisions D731–D749. `pnpm verify` green (3437 unit tests), e2e 165/165. The b55 agent could not push its branch (Git Credential Manager sign-in); it was merged from the local branch. Visual QA differences for Kyle to sign off or turn into tickets: 01/08–10 the board header wraps to two rows at 1440 px (Team menu and Settings), moving the lanes down about 70 px, and New agent ticket drops to a second line; 08–10 the lanes and team board don't fit at 960 px tall (artboards are 1360 px), so dragging scrolls the lane tops, drop hints and the "Drop !10571" pill out of view; 08 the team board's Backlog button wraps under the title and shows its count as text (artboard: right-aligned count badge); 08 lock rows say "Assigned to Mia Davies" (artboard and TB§2: initials); 08 PR cards show the first reviewer's avatar while artboard 08 shows the author's (TB§2 says reviewer; design owner to pick); 08 cards ordered by id, not backlog rank (D590); 10 the launch toast sits bottom-right (artboard: top-right under the header) and the dropped card lands below #71322 instead of on top; 04 the "Design system" pill in Attached sits above its row's text (Pill `alignSelf: flex-start` in a row); 02 the Sprint 42 list includes a Closed item (#71250); 06 the card-states sheet has 4 cards per row (artboard 5) and the Status badges block isn't beside the toast; 07 two extra swatches (claude-text, danger); 11/12 see D735–D736. Other follow-ups: in the popped-out backlog the "Agent in …" tag updates only on refetch (agent events go to the main window only); AL-234's "Backlog stays disabled until AL-239" gap is now closed and its artboard 08 criterion can be re-checked at AL-223's sign-off. |
| 2026-10-08 | Parallel build complete: every buildable ticket merged (97 done, 39 partial; AL-224 and AL-226 wait on Kyle). Final check on `main`: `pnpm verify` green (3,437 tests), e2e 164/165 with the one failure (repos.spec "picking a non-git folder") passing on rerun; load-related e2e flakes stay open under AL-220. Added AL-242 (Board picker) from Kyle's request; recorded the on-prem decisions. |
| 2026-10-09 | Merged board polish from Kyle's first real use: stage comments off by default, QA-only agent comments, auto permission mode, ADO type/state colours, sticky header and collapsed agent board strip; ADO failures now log the server's reason. `pnpm verify` green (3,513 tests), e2e 169/169 on the branch. Open: confirm auto mode in a real session (API-key sign-in), Enter on a strip cell right after an Escape-cancelled drag. |
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
