# Handoff — Ticket screen: Flight deck + Code City layouts

Oct 13, 2026 · @Kyle

Rebuild the Agent Lanes ticket screen with two layouts over the same data, switched by a slider in the header. **Flight deck** (Direction A) is the new default layout. **Code City** (Direction D) is the alternate: an isometric 3D city where each changed file is a building, folders are districts, and agents appear as pins over the files they are working on. This document is the full spec for one agent to build both in one session inside the existing React Native + Electron app.

## Reference design

The sources of truth are two artboards on the Agent Lanes design canvas: **A · Flight deck** (`AgentA-FlightDeck.dc.html`) for the default layout and **D · Code city, isometric 3D** (`AgentD-CodeCity.dc.html`) for the alternate. Match their layout, colours and copy; where this document and an artboard disagree, this document wins. The table below describes the Code City areas; the Flight deck areas are specified in their own section.

**Flight deck (default layout)**

&#91;image: Flight deck reference artboard\]

**Code City (alternate layout)**

&#91;image: Code City reference artboard\]

| Area | What it shows | Source of data |
| --- | --- | --- |
| Header | Back to board, PR and work-item chips, ticket title, session stats (time · tokens · cost · context %), Build, Run, Merge menu | Existing `ticket-header` widget, unchanged |
| City scene | Isometric plane with one building per changed file, grouped into folder districts; red hatched ground for removed lines; agent pins over the file each running agent is touching | New `code-city` widget |
| How-to card (bottom left of scene) | Legend: height = lines added, red ground = lines removed, district = folder, colour = agent | Static copy |
| Crew on site (top right of scene) | Every agent in the session with model and a status word | Agent store |
| Stage track | The five stages with gate labels and progress of the active stage | Existing stage data, new visual |
| Composer | Skill chip, message input, steer-now toggle, model and effort, Send | Existing `send-message` feature, restyled to the glass bar |
| Inspector (right rail) | Selected file: name, folder, author agent, +added, −removed, review status | Diff numstat + attribution + review findings |
| Blueprint diff | Unified/split diff of the selected file | Existing diff renderer |
| Inspector's notes | Reviewer findings for that file | Review agent findings |
| Worktree | Last build result, Merge sub-branches, Merge worktree → main checkout | Existing `merge-branches` and `build-run` features |

## Layout slider

A two-position slider in the ticket header switches the body between Flight deck and Code City. The header stays put, and the selection, follow-agent setting and composer draft carry across the switch.

**The control**

- Sits in the ticket header, right-aligned on the title row, left of the session pills.
- Two segments with an icon and a label: **Flight deck** (three-columns icon) and **Code city** (buildings icon). A white thumb with a soft shadow slides under the active segment.
- Size: track 260 × 40 px, radius 12 px, background `#EEF2F7`. Thumb radius 9 px, inset 4 px, shadow `0 1px 2px rgba(15,27,45,.08), 0 2px 6px rgba(15,27,45,.06)`. Active label `#4A3BB0`, inactive `#475569`, Plus Jakarta Sans 600 13 px.
- Thumb motion: `transform: translateX(...)`, 220 ms `cubic-bezier(0.22, 1, 0.36, 1)`. The thumb can also be dragged; on release it snaps to the nearer side.
- Semantics: `role="radiogroup"` with two `role="radio"` segments and `aria-label="Ticket layout"`. Left and Right arrows move the selection. App-wide shortcut: Ctrl+Shift+L toggles.

**The switch**

- Only the body below the header swaps. The header (breadcrumbs, title, session pills, slider) never re-renders.
- Transition: the outgoing body fades to 0 and slides 24 px toward the side it is leaving; the incoming body fades in from 24 px on the other side. Both take 280 ms, with the incoming body starting at 80 ms. With `prefers-reduced-motion`, the swap is instant.
- Code City is loaded with `React.lazy` the first time it is chosen. A skeleton plane (grey isometric grid, no buildings) shows for up to 300 ms while it loads.

**State carried across the switch** (all of it lives in the `ticket-view` Zustand slice, not in either layout)

| State | Flight deck uses it as | Code City uses it as |
| --- | --- | --- |
| `selectedFilePath` | Highlighted change-map tile and the file shown in the diff | Highlighted building and the file in the inspector |
| `followAgent` | Diff jumps to the file the lead is editing | Selection jumps to the building under the running agent's pin |
| `diffMode` (unified \| split) | Diff panel toggle | Blueprint diff toggle |
| `selectedTurn` | Turn strip highlight and output scroll position | Not shown; kept for when the user switches back |
| Composer draft, skill chip, steer toggle, model, effort | Composer in the output column | Glass composer bar under the city |

**Persistence**

- The chosen layout is a user preference, `ticketLayout: 'flightDeck' | 'codeCity'`, saved in the existing preferences store (electron-store). It is not a file the user edits. The default is `flightDeck`.
- It applies to every ticket and is restored on restart.
- On a native (non-web) render target, the slider is hidden and Flight deck is always used, because Code City depends on CSS 3D transforms.

## Flight deck layout (default)

Flight deck keeps today's three-column ticket screen and makes the workflow, the turns and the agents readable at a glance. Build it from the A artboard, using these rules for the data.

**Frame:** page padding 14 px top, 18 px sides and bottom; 12 px gaps. Below the header there are two rows: the workflow card, then the body grid `minmax(0, .95fr) minmax(0, 1.25fr) 330px` (output · diff · right rail).

**Workflow card (glass, radius 20)**

- **Stage cards:** five in a row, `flex: 1`, with the active stage at `flex: 1.5`. Each card shows a number or check dot, the stage name, a gate chip (Approved green · Approval amber · Auto grey) and a meta line.
  - Done stages: "{duration} · {turns} turns · ${cost}".
  - Active stage: a progress line plus a 5 px progress bar (violet → sky gradient). Progress for Code review = files reviewed ÷ files changed. For Implementing, use the plan's completed steps ÷ total steps when the plan has them; otherwise show an indeterminate shimmer.
  - Future stages: what happens next ("cs-qa-wip next", "waits for you").
- **Turn strip:** one button per turn, `flex-grow` = turn duration in minutes, `min-width: 26px`, height 30, radius 8. It is filled with the colour of the agent that led the turn and shows "T{n}" plus the cost. The live turn uses a violet gradient. Clicking a turn sets `selectedTurn` and scrolls the output to it. The total ("7 turns · $2.06") sits at the right.

**Output column**

- Finished turns collapse to one row each: a 6 px agent-coloured bar, the turn's first summary sentence, the meta line "Turn {n} · {duration} · ${cost}", and a mono chip with tool counts ("Edit 3 · Bash 4", the top two tools). Clicking a row expands it to the full transcript.
- The live turn is always expanded, with a pulsing dot, its tool rows and the agent's prose.
- The composer is pinned to the bottom of the column (existing `send-message` feature): skill chip, Steer now / after the turn, textarea, Send, and the model and effort segments.

**Diff column**

- Header: "Ticket branch vs base", file count and +/− totals, Follow agent switch, Unified / Split segments.
- **Change map:** one tile per changed file, sorted by lines changed (largest first). `flex-grow` = added + removed, `min-width: 24px`, height 44, radius 10. The tile is tinted with its author agent's colour and shows the file name. Along its bottom is a 6 px bar split green (added) and red (removed). Clicking a tile sets `selectedFilePath`, and the selected tile gets a 2 px ring in the agent colour. A legend underneath lists the agent colours, with "width = lines changed" at the right.
- **File header:** colour dot, path, "by {agent}" and the +/− counts.
- **Diff body:** the existing diff renderer, plus a 4 px author stripe in the agent colour on every changed line.

**Right rail**

- **Agents card:** a donut (84 px, stroke 5) with one segment per agent, coloured by state: running `#818CF8` and pulsing, done `#34D399`, lead `#5B4BC4`. The total sits in the middle. A legend beside it shows the counts and "{n} sub-branches ready".
  - One row per agent: an initial tile in the agent colour, name and model, a token bar (share of the largest agent's tokens), and a status pill.
  - Under the rows: Assign new agent and Add agent.
- **Worktree card:** branch name, Build / Run / Stop, the last build line, Merge {n} sub-branches, Merge worktree → main checkout, and the uncommitted-changes warning in amber.

**Agent colours:** shared with Code City and assigned once per session. The lead is always `#5B4BC4`. Sub-agents take colours in spawn order from `#0369A1, #0D9488, #7C3AED, #B45309, #DB2777, #64748B`, and the order repeats after six. Put the colour on the `agent` entity so that both layouts read the same value.

## Where it lives

`TicketPage` becomes a frame: the shared header with the slider, then one of two layout widgets. Both layouts read the same entities and features. Only presentation differs.

```
apps/desktop/src/renderer/
  pages/ticket/
    ui/TicketPage.tsx               frame: header + <LayoutSwitch/> + body
    model/ticketViewStore.ts        Zustand: layout, selectedFilePath, followAgent, diffMode, selectedTurn
  widgets/
    ticket-header/                  existing; add <LayoutSlider/> slot
    layout-slider/
      ui/LayoutSlider.tsx           radiogroup slider, drag + keyboard
      ui/LayoutSwitch.tsx           animated body swap, React.lazy for code city
      layout-slider.test.tsx
    flight-deck/
      ui/FlightDeck.tsx             3-column grid
      ui/WorkflowCard.tsx           stage cards + turn strip
      ui/TurnStrip.tsx
      ui/GroupedOutput.tsx          collapsed turns + live turn
      ui/ChangeMap.tsx
      ui/AgentDonut.tsx
      flight-deck.test.tsx
    code-city/
      ui/CodeCity.tsx               scene + overlays + side rail
      ui/CityScene.web.tsx          CSS 3D plane (web only)
      ui/CityScene.tsx              native fallback: renders null (slider is hidden on native)
      ui/Building.web.tsx
      ui/LabelLayer.web.tsx         2D overlay labels projected from building tops
      ui/AgentPins.web.tsx
      ui/CrewPanel.tsx
      ui/StageTrack.tsx
      ui/BuildingInspector.tsx
      ui/InspectorNotes.tsx
      ui/code-city.css              exact CSS from the 3D rendering section
      model/layoutCity.ts           pure layout function
      model/layoutCity.test.ts
      code-city.test.tsx
  entities/
    agent/      add `color` + `activeFile` to the model
    diff-file/  NEW: DiffFile type, useDiffFiles() query, author attribution
    turn/       NEW: Turn type, useTurns() selector over the session store
    review-finding/ NEW: ReviewFinding type, useReviewFindings(filePath)
  shared/api/ipc.ts                 add the channels from the next section
packages/contracts/src/diff.ts      zod schemas for DiffFile, ReviewFinding, AgentActivity
apps/desktop/src/main/
  diff/numstat.ts                   git diff --numstat + rename detection
  sessions/attribution.ts           per-file author tracking
```

- Reuse what exists: `send-message` (composer), `build-run`, `merge-branches`, `change-model`, the diff renderer, `ticket-header` and the stage data. Do not fork them; restyle through props.
- Respect the FSD direction: widgets import features, entities and shared, never each other. `LayoutSwitch` imports both layouts through their `index.ts` and nothing else.
- `*.web.tsx` files are picked up by the react-native-web resolver. Code City renders plain DOM elements there, which react-native-web allows, so `transform-style: preserve-3d` and `perspective` work.

## Data contracts and IPC

Two new invoke channels, one reused channel and two event streams feed both layouts. Validate every payload with zod in `packages/contracts`.

```ts
// packages/contracts/src/diff.ts
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';

export interface DiffFile {
  path: string;            // repo-relative, forward slashes
  oldPath?: string;        // when kind === 'renamed'
  kind: ChangeKind;
  added: number;           // 0 for binary
  removed: number;
  authorAgentId: string | null;   // null = unknown or human
  touchedBy: string[];     // every agent id that edited it, first editor first
  uncommitted: boolean;    // true when the change is only in the working tree
}

export type ReviewStatus = 'notReviewed' | 'inReview' | 'passed' | 'changesRequested';

export interface ReviewFinding {
  id: string;
  filePath: string;
  line: number | null;
  severity: 'info' | 'warn' | 'error';
  text: string;            // one or two sentences
  agentId: string;         // the reviewer
  prThreadId?: number;     // set once posted to ADO via /pr-comment-actioner
}

export interface AgentActivity {
  agentId: string;
  filePath: string | null; // null = not on a file (thinking, running a command)
  kind: 'read' | 'edit' | 'review' | 'test' | 'idle';
  at: string;              // ISO time
}

export interface Turn {
  index: number;           // 1-based
  leadAgentId: string;     // agent that ran most tool calls in the turn
  startedAt: string; endedAt: string | null;  // null = live
  costUsd: number;
  stage: 'planning' | 'implementing' | 'codeReview' | 'qa' | 'createPr';
  summary: string;         // first sentence of the turn's final message
  toolCounts: Record<string, number>;
}
```

| Channel | Kind | Request → response | Notes |
| --- | --- | --- | --- |
| `diff:files` | invoke | `{ ticketId }` → `{ base: string; head: string; files: DiffFile[]; reviewStatus: Record<string, ReviewStatus> }` | Base = the merge-base with the ticket's base branch; includes uncommitted changes |
| `diff:file` | invoke | `{ ticketId, path }` → existing unified-diff payload | Already exists for the diff panel; reuse it |
| `review:findings` | invoke | `{ ticketId }` → `ReviewFinding[]` | Parsed from the reviewer's structured output (see the next section) |
| `agent:activity` | event | `AgentActivity` | Emitted by the session manager on every Read/Edit/Write/Task tool call |
| `turn:update` | event | `Turn` | Emitted when a turn starts, gains a tool call, or ends |

**Renderer side**

- `useDiffFiles(ticketId)`: TanStack Query key `['diff','files',ticketId]`. It refetches when a `turn:update` arrives with a new tool count for Edit or Write (debounced 1 s), and on window focus. Never poll faster than 5 s.
- The `agent:activity` events go into the existing agent Zustand slice as `activeFile` and `activeKind` per agent. Only the latest event per agent is kept.
- `turn:update` events go into a `turns` slice keyed by index.
- `useReviewFindings(ticketId)`: key `['review','findings',ticketId]`, refetched on `turn:update` for the reviewer agent.

## Agent attribution

Each changed file is credited to the agent that wrote most of its lines. The main process works this out from the tool calls it already sees, so no git blame is needed.

1. `sessions/attribution.ts` keeps, per ticket, an in-memory map `path → { agentId → linesWritten }`, and appends to `touchedBy` the first time an agent edits a file.
2. For every `Edit`, `MultiEdit` or `Write` tool call from the lead or any sub-agent, add the line count of the new text to that agent's entry for the file. For `Write`, use the whole file's line count.
3. `authorAgentId` = the agent with the highest `linesWritten`. On a tie, the agent that edited the file first wins.
4. A file that changed with no recorded tool call (the user edited it, or a merge brought it in) gets `authorAgentId: null`. It is drawn in neutral grey `#94A3B8` and labelled "by you or a merge".
5. Sub-agent edits on their own sub-branch still count for the ticket. When the sub-branch is merged, the credit stays with the sub-agent.
6. The map is rebuilt on start-up by replaying the session transcripts of the ticket's sessions, which the app already keeps. Nothing new is stored on disk.

**Review status and findings**

- The review agent is started with an instruction to end each file with a fenced JSON block: `{"file": path, "status": "passed" | "changesRequested", "findings": [{"line": n, "severity": "warn", "text": "..."}]}`. `review:findings` parses these blocks from its transcript.
- `inReview` = the reviewer's latest `agent:activity` is a `read` or `review` of that file. `notReviewed` = no block and no activity yet.
- When /pr-comment-actioner posts a finding to the PR, record the returned thread id on the finding as `prThreadId`. The inspector then shows "Posted to PR" with a link.

**Active file per agent (for pins and Follow agent)**

- Set on each `agent:activity` event and cleared when `kind` is `idle` or the agent's session ends.
- A pin is shown only for agents whose status is running and whose `activeFile` is in the current diff. Other running agents appear in the crew panel only.

## City layout algorithm

`layoutCity(files)` is a pure, deterministic function: the same files always produce the same city, so buildings never jump between renders. It returns plane-space coordinates in px. Test it without a DOM.

```ts
// widgets/code-city/model/layoutCity.ts
export interface CityBuilding { path: string; x: number; y: number; side: number; height: number;
  rubble?: { x: number; y: number; w: number; d: number }; kind: ChangeKind; }
export interface CityDistrict { key: string; label: string; x: number; y: number; w: number; d: number; }
export interface CityLayout { width: number; depth: number; districts: CityDistrict[]; buildings: CityBuilding[]; overflow: number; }

const MAX_BUILDINGS = 40, PLANE_W = 880, GUTTER = 30, PAD = 30, LABEL = 40, ROW_W = 300;

export function districtKey(path: string, commonPrefix: string): string {
  const dir = path.slice(commonPrefix.length).split('/').slice(0, -1);
  return dir.length === 0 ? '(root)' : dir.slice(0, 2).join('/');
}
export const side = (total: number) => clamp(round10(40 + 8 * Math.log2(1 + total)), 56, 120);
export const height = (added: number) => (added === 0 ? 0 : clamp(Math.round(added * 1.35), 14, 240));
export const rubble = (removed: number) => { const w = clamp(Math.round(30 + removed * 2.2), 30, 160); return { w, d: Math.round(w * 0.75) }; };
```

**Steps**

1. **Common prefix:** strip the longest directory prefix shared by every path (for example `OnSiteCompanion/ComponentLibrary/`) so district names stay short.
2. **Districts:** group by `districtKey`, which is the first two remaining directory segments. The label is the key with `/` shown as " / " ("Pages / Companion").
3. **Order:** districts by total lines changed (descending), then name. Within a district, files by `added + removed` (descending), then path.
4. **Cap:** keep the first 40 files overall in that order. The rest become one grey "{n} more files" plot in the last district row, and `overflow = n`.
5. **Buildings inside a district:** place left to right in rows no wider than `ROW_W`, with 30 px between footprints. A file with `removed > 0` reserves its rubble tile right after its building (12 px gap). A deleted file has height 0 and only rubble. A binary file is a 10 px slab in grey `#CBD5E1`.
6. **District plate:** the bounding box of its rows plus `PAD` on three sides and `LABEL` at the front edge for the label.
7. **Plane packing:** shelf-pack the plates left to right into rows no wider than `PLANE_W`, with `GUTTER` between plates and rows. `depth` = the bottom of the last row. If depth exceeds 680, the scene scales to fit (see the next section).
8. **Stability:** only the inputs decide the positions. When a file is added or grows, the layout is recomputed and the building moves with a 300 ms transition on left and top, so the user sees it slide rather than jump.

**Worked example** (the reference ticket, common prefix `OnSiteCompanion/`)

| File | District | added / removed | side | height | rubble w × d |
| --- | --- | --- | --- | --- | --- |
| ComponentLibrary/Pages/Companion/FailedSyncFiles.razor | ComponentLibrary / Pages | 120 / 0 | 100 | 162 | — |
| Tests/Companion/FailedSyncFilesTests.cs | Tests / Companion | 64 / 0 | 90 | 86 | — |
| Legacy.WinExe/OfflineSynchronisation/frmFailedFiles.vb | Legacy.WinExe / OfflineSynchronisation | 3 / 44 | 80 | 14 (min) | 127 × 95 |
| ComponentLibrary/Pages/Companion/FailedSyncFiles.razor.cs | ComponentLibrary / Pages | 38 / 2 | 80 | 51 | 34 × 26 |
| ComponentLibrary/Components/CompanionGridFormatter.cs | ComponentLibrary / Components | 6 / 1 | 60 | 14 (min) | 32 × 24 |

The table above is what `layoutCity` must return for these sizes. Put it in `layoutCity.test.ts` as the golden case.

## 3D rendering spec

The city is pure CSS 3D: one rotated plane with one `div` box per building. There is no WebGL and no canvas. Labels and pins are not drawn in 3D. They sit on a flat overlay layer and are positioned from each building's projected top face, which avoids the label drift seen in the prototype.

**Scene structure**

```tsx
<div className="cc-scene" ref={sceneRef}>            // perspective container, fills the panel
  <div className="cc-fit" style={{ transform: `scale(${fit})` }}>
    <div className="cc-plane" style={{ width: layout.width, height: layout.depth }}>
      <div className="cc-ground" />                    // white grid ground, inset -40px
      {layout.districts.map(d => <div className="cc-plot" .../>)}
      {buildings.map(b => b.rubble && <div className="cc-rubble" .../>)}
      {buildings.map(b => <Building key={b.path} ... />)}
    </div>
  </div>
  <LabelLayer anchors={anchors} />                     // flat, absolutely positioned
  <AgentPins anchors={anchors} />
</div>
```

**CSS (`code-city.css`, copy exactly)**

```css
.cc-scene{position:relative;height:100%;min-height:560px;perspective:2400px;perspective-origin:50% 30%;overflow:hidden;
  border-radius:28px;border:1px solid #E8EDF4;background:linear-gradient(180deg,#EAF2FF 0%,#F4F7FB 55%,#EEF2F7 100%)}
.cc-fit{position:absolute;left:50%;top:46%;transform-origin:0 0}
.cc-plane{position:absolute;transform-style:preserve-3d;transform:translate(-50%,-50%) rotateX(58deg) rotateZ(-42deg)}
.cc-ground{position:absolute;inset:-40px;border-radius:40px;background-color:#fff;box-shadow:0 0 0 1px #E2E8F0;
  background-image:linear-gradient(#EEF2F7 1px,transparent 1px),linear-gradient(90deg,#EEF2F7 1px,transparent 1px);background-size:40px 40px}
.cc-plot{position:absolute;border-radius:22px;border:2px dashed var(--plot-border);background:var(--plot-bg)}
.cc-rubble{position:absolute;border-radius:14px;box-shadow:inset 0 0 0 2px #F87171;
  background:repeating-linear-gradient(45deg,#FECACA 0 10px,#FEE2E2 10px 20px)}
.cc-b{position:absolute;transform-style:preserve-3d;cursor:pointer;transition:left .3s ease,top .3s ease}
.cc-b .top{position:absolute;inset:0;transform:translateZ(var(--h));background:var(--c1);border-radius:6px}
.cc-b .win{position:absolute;inset:0;transform:translateZ(calc(var(--h) + 1px));border-radius:6px;opacity:.6;
  background-image:radial-gradient(rgba(255,255,255,.55) 1.4px,transparent 1.6px);background-size:12px 12px}
.cc-b .s{position:absolute;left:0;bottom:0;width:100%;height:var(--h);transform-origin:bottom;
  transform:rotateX(-90deg);background:linear-gradient(0deg,var(--c1),var(--c2))}
.cc-b .e{position:absolute;right:0;top:0;width:var(--h);height:100%;transform-origin:right;
  transform:rotateY(90deg);background:linear-gradient(270deg,var(--c3),var(--c2))}
.cc-b .shadow{position:absolute;inset:-10px;transform:translate(14px,14px);background:rgba(15,27,45,.10);filter:blur(10px);border-radius:10px}
.cc-b[aria-selected="true"] .top{box-shadow:0 0 0 4px #5B4BC4,0 0 24px rgba(91,75,196,.6)}
.cc-b:focus-visible .top{box-shadow:0 0 0 4px rgba(91,75,196,.45)}
.cc-b.rising .top,.cc-b.rising .s,.cc-b.rising .e{transition:transform .4s cubic-bezier(.22,1,.36,1),height .4s cubic-bezier(.22,1,.36,1)}
@keyframes cc-bob{0%,100%{transform:translate(-50%,-100%)}50%{transform:translate(-50%,calc(-100% - 8px))}}
.cc-pin{position:absolute;animation:cc-bob 2s ease-in-out infinite;pointer-events:none}
@media (prefers-reduced-motion:reduce){.cc-pin{animation:none;transform:translate(-50%,-100%)}.cc-b,.cc-b *{transition:none}}
```

**Building element**

- `<div className="cc-b" role="option" tabIndex aria-selected style={{left, top, width: side, height: side, '--h': height+'px', '--c1', '--c2', '--c3'}}>`, with children in this order: shadow, s, e, top, win. The order matters for stacking.
- Face colours come from the author agent colour C: `--c1` = mix(C, white, 55%), `--c2` = mix(C, white, 15%), `--c3` = mix(C, black, 20%). Put a `shade(hex, amount)` helper in `shared/lib/color.ts`. For an unknown author, use C = `#94A3B8`.
- When a building's height grows (new lines arrive), add the class `rising` for 400 ms so the faces animate to the new height.

**District plots:** the background is the agent-neutral tint `rgba(224,242,254,.6)` (blue) and the border is `#7DD3FC`, rotating per district through four pairs: blue, violet `rgba(238,235,255,.6)`/`#C4B5FD`, teal `rgba(204,251,241,.5)`/`#5EEAD4`, slate `rgba(241,245,249,.8)`/`#CBD5E1`.

**Fit to panel:** `fit = min(sceneW / (layout.width * 1.35), sceneH / (layout.depth * 1.15), 1)`. Recompute it with a ResizeObserver on `.cc-scene`.

**Anchors, labels and pins (the projection)**

- After every layout or resize, in `useLayoutEffect`, read `getBoundingClientRect()` of each building's `.top` face and of each district plot. Subtract the scene's rect. Store `{path → {x: rect.left + rect.width/2, y: rect.top}}` as `anchors`.
- `LabelLayer` renders, per building, a mono 12 px chip at `left: x; top: y - 8px; transform: translate(-50%, -100%)`: name, then +added in `#047857`, then −removed in `#B91C1C`. Styling: white 92% background, 1 px border (`#5B4BC4` when selected, else `#E2E8F0`), radius 9 px, padding 4 × 9 px.
- District labels: 11 px, weight 800, uppercase, tracking .06em, in the plot's border colour, at the plot's front-left corner anchor.
- Rubble label: "demolished −{removed}", 12 px, weight 800, `#B91C1C`, on a white 90% chip, at the rubble tile's anchor.
- `AgentPins`: for each running agent with an `activeFile` in the city, place a `.cc-pin` at that building's anchor, raised 30 px above the label. It shows a pill (agent colour background, white 12 px weight 800 text: "{name} · {verb}") and a 3 × 26 px stem. Verbs by activity kind: edit → building, review → inspecting, test → testing, read → reading.
- When two labels overlap (rect intersection), move the later one up by its height plus 4 px, and repeat until clear. Do at most 3 passes.

## Code City panels

The Code City body is a two-column grid, `minmax(0, 1fr) 450px`, with a 12 px gap. On the left is the scene, with the stage track and composer stacked under it. On the right is the inspector rail.

**Overlays on the scene** (glass, radius 16, 16 px from the scene edges)

- **How-to card (bottom left), max width 250 px:** "Code city" in 14 px weight 800, then "Each building is a file. Height = lines added, red ground = lines removed. Districts are folders, and the colour shows which agent built it." and "Click a building to inspect its diff." in `#5B6B82`. It has a close button and stays dismissed once closed (stored in prefs as `codeCityLegendDismissed`).
- **Crew on site (top right), min width 210 px:** one row per agent with a colour square, name, model and a right-aligned status word in the agent's status colour. Words: lead running → Directing; review → Inspecting; edit → Building; test → Testing; done → Off shift; error → Stopped. Running rows pulse. Clicking a row selects that agent's `activeFile` building, if it has one.

**Stage track** (glass, radius 18, under the scene)

- Five stops, each with a 34 px rounded square (✓ or the number), the stage name and its gate or progress line. Roads (8 px pills) join the stops.
- Done stop green `#059669`, active stop violet `#5B4BC4` with a 6 px halo, future stop `#E2E8F0`. A done road is `#34D399`. The active road is a gradient split at the stage progress ("Inspecting · 60%"). A future road is `#E2E8F0`.
- Uses the same stage data as Flight deck's stage cards.

**Composer** (glass bar, radius 18, under the stage track): skill chip, input (placeholder "Tell the crew what to build next"), "Steer now ○" toggle, model and effort dropdown, Send. It is the existing `send-message` feature in its compact variant.

**Inspector rail** (top to bottom)

1. **Building card:** a 44 px tile with the agent colour gradient (c1 → c3), the mono file name, "{district} · built by {agent}", then three stat tiles: "+{added}" labelled "floors added" (green tint), "−{removed}" labelled "demolished" (red tint), and the review status labelled "inspection". Status words: In review, Passed, Changes requested, Not reviewed. Renamed files show "renamed from {oldPath}" under the name.
2. **Blueprint diff:** the existing diff renderer with the Unified / Split toggle bound to `diffMode`. It fills the remaining height and scrolls internally.
3. **Inspector's notes:** findings for the selected file from `useReviewFindings`. Each finding shows "Line {n}:" in bold, then the text. Info findings are `#F8FAFC`, warn are amber `#FFFBEB` with text `#78350F`, and error are red `#FEF2F2` with text `#7F1D1D`. When a finding has a `prThreadId`, it shows "Posted to PR" with a link to the thread. The header reads "reviewer · posts via /pr-comment-actioner". If there are no findings, show "No notes yet." in muted text.
4. **Worktree card:** the last build line, Merge {n} sub-branches, and Merge worktree → main checkout. These reuse the existing features, so their confirmation and uncommitted-changes behaviour is unchanged.

Build, Run and Merge also stay in the header for both layouts, as in the artboard.

## Interaction, keyboard and accessibility

| Action | Flight deck | Code City |
| --- | --- | --- |
| Select a file | Click a change-map tile | Click a building or its label, or a crew row with an active file |
| Hover | Tile tooltip: full path, +/−, author | Building tooltip after 300 ms: full path, +/−, author, review status. The top face brightens 6% |
| Follow agent on | The diff jumps to the file the lead or the running sub-agent last edited | The selection jumps to the building under the most recent `agent:activity` (edit or review). Turning Follow off is sticky until the user turns it back on |
| Clear selection | Esc | Esc, or click empty ground |
| Switch layout | Slider, Ctrl+Shift+L | Same |
| Pick a turn | Click a turn in the strip | Not available. The turn strip is a Flight deck feature |

**Keyboard in Code City**

- The plane is a `role="listbox"` with `aria-label="Changed files"`. Each building is a `role="option"` with `aria-selected`, and the listbox uses roving `tabIndex`: one Tab stop for the whole city.
- Arrow keys move in reading order (district order, then building order from `layoutCity`). Home and End go to the first and last building, and Enter or Space selects.
- Each building's accessible name is "{file name}, {district}, {added} lines added, {removed} removed, by {agent}, {review status}".
- A visually hidden live region announces pin moves at most once every 5 seconds, for example "reviewer is inspecting FailedSyncFiles.razor".

**Accessibility rules for both layouts**

- Colour never carries meaning alone. Every agent colour sits next to the agent's name, and +/− counts are always printed as numbers.
- Text contrast is at least 4.5:1, which matters for pills on tints. Focus rings are `0 0 0 3px rgba(91,75,196,.4)`.
- `prefers-reduced-motion`: no bobbing pins, no pulse, no building growth animation, and an instant layout swap.
- Hit targets: buildings are at least 56 px square in plane space. When `fit` scales a building below 32 px on screen, its label chip becomes clickable too.

## States and edge cases

| Case | Flight deck | Code City |
| --- | --- | --- |
| Diff loading | Skeleton tiles in the change map | Grey isometric grid with 3 ghost buildings pulsing; the rail shows skeleton rows |
| No changes against base | "No changes against the base yet." in the diff panel | An empty plot in the centre labelled "Empty lot — no changes against {base} yet"; crew panel still shows agents |
| Only uncommitted changes | An amber "Includes uncommitted changes" chip in the diff header | Same chip in the inspector header; uncommitted buildings get a dashed amber outline on the top face |
| Deleted file | A tile with a red-only bar | Rubble tile only, no building; the label reads "{name} deleted −{removed}" |
| Renamed file | Tile shows the new name with a ↷ marker | Building at the new path; the inspector says "renamed from {oldPath}" |
| Binary file | Tile with "binary" | 10 px grey slab; the inspector says "Binary file — no diff" |
| More than 40 files | All shown; the map scrolls horizontally | First 40 by size; a grey "{n} more files" plot opens a plain file list popover |
| A file over 180 added lines | Normal | Height capped at 240 px; a small "tall" badge on its label |
| Author unknown | Grey tile, "by you or a merge" | Grey building `#94A3B8` |
| Agent's active file not in the diff (a read of an unchanged file) | Agent row shows "Reading {name}" | No pin; the crew row shows "Reading" |
| Session ended or idle | No live turn card; the turn strip has no live segment | No pins; all crew "Off shift"; the stage track still shows progress |
| `diff:files` error | Inline error in the diff panel with Retry | Error card centred on the scene with Retry; the rail stays usable |
| Window narrower than 1200 px | Right rail moves under the diff | The inspector rail becomes a bottom sheet (40% height) that opens when a building is selected |
| Native target | Normal | Not available; the slider is hidden |

## Performance budget

| Measure | Budget | How |
| --- | --- | --- |
| Layout switch (Flight deck → Code City, warm) | First frame under 100 ms; animation at 60 fps | Code City is lazy-loaded once and kept mounted but hidden (`display:none`) after the first visit |
| `layoutCity` for 40 files | Under 2 ms | Pure function, memoised on a hash of `path:added:removed` |
| Anchor projection | Under 4 ms per pass | One `getBoundingClientRect` read pass, then one state write; run in `requestAnimationFrame` after layout or resize, never during a transition |
| Live updates | At most 1 re-layout per second | `diff:files` refetch debounced to 1 s; `agent:activity` only moves pins and never re-lays the city |
| DOM size | About 6 elements per building, under 300 for 40 files | No per-line DOM in the scene; the diff renderer virtualises lines (existing) |
| Memory | Under 15 MB extra | No textures or canvas; CSS gradients only |

Animate only `transform` and `opacity`. The 300 ms left/top slide on a re-layout is the one exception, and it happens at most once a second. Set `will-change: transform` on `.cc-pin` only.

## Build order for one session

Work in this order and commit after each step. Each step leaves the app runnable, so a session that runs out of time still ships Flight deck.

1. **Contracts and main process.** Add the zod schemas. Then add `diff/numstat.ts` (`git diff --numstat -M <merge-base>` plus `git diff --numstat` for the working tree, merged by path) and `sessions/attribution.ts` with replay on start-up. Wire `diff:files`, `review:findings`, `agent:activity` and `turn:update`. Unit-test numstat parsing and attribution with fixture transcripts.
2. **Entities.** Add `diff-file`, `turn` and `review-finding` with their queries and selectors. Add `color` and `activeFile` to `agent`, with the colour assigned in spawn order.
3. **Ticket view store and frame.** Add `ticketViewStore`, turn `TicketPage` into header + body, and keep the current body as a temporary child so nothing breaks.
4. **Flight deck.** Build `WorkflowCard` (stage cards + turn strip), `GroupedOutput`, `ChangeMap`, the diff author stripe and `AgentDonut`. Reuse the composer, worktree and merge features. Replace the old body with `FlightDeck`. Match the A artboard.
5. **Layout slider.** Build `LayoutSlider` and `LayoutSwitch` with the `ticketLayout` preference, the shortcut and the transition. Code City can be a placeholder at this point.
6. **`layoutCity`** plus its golden test from the worked example.
7. **City scene.** Add `code-city.css`, `CityScene.web.tsx` and `Building.web.tsx` with face colours and fit-to-panel. Check visually against the D artboard: buildings must stand up from the ground with the darker face on the right.
8. **Anchors and overlays.** Add `LabelLayer`, `AgentPins`, the district and rubble labels, and overlap nudging.
9. **Code City panels.** Add the crew panel, how-to card, stage track, compact composer, and the inspector rail with the blueprint diff and inspector's notes.
10. **Interaction and accessibility.** Selection shared with Flight deck, Follow agent, the listbox keyboard model, tooltips, the live region and reduced motion.
11. **States.** Work through every row of the states table.
12. **Tests and polish.** Run the acceptance checks below and the Playwright screenshots, and fix anything that doesn't match.

**Gotchas found while prototyping**

- The side face needs `rotateX(-90deg)` with `transform-origin: bottom`. With `+90deg` the building hangs below the ground.
- Labels placed in 3D with an inverse-rotation billboard drift away from their buildings. Project them from `getBoundingClientRect` of the top face as specified.
- react-native-web does not pass `transformStyle` and `perspective` through `StyleSheet` reliably. Use plain DOM elements and the CSS file inside `*.web.tsx`.
- Text inside SVG does not render reliably in the canvas prototype runtime. That doesn't affect the app, but keep the turn strip and stage cards as HTML, not SVG text.
- Electron's renderer must not block on the main-process `git diff`. Run it with `execFile` in the main process and stream the result.

## Acceptance criteria and tests

**Acceptance criteria** (all must pass before the PR)

- [ ] A ticket opens in Flight deck by default and matches the A artboard: stage cards with gate chips, the turn strip with costs, grouped output, the change map, the author stripe in the diff, the agent donut, and the worktree card.
- [ ] The header slider switches to Code City and back, with the animation (or an instant swap under reduced motion), Ctrl+Shift+L and arrow keys. The choice survives an app restart.
- [ ] Selecting a file in either layout keeps it selected in the other. The same goes for diff mode and the composer draft.
- [ ] Code City draws one building per changed file, grouped into districts, with heights, footprints and rubble matching `layoutCity`. Faces use the author agent's colour, and the darker face is on the right.
- [ ] Labels sit directly above their building's top face at every window size from 1200 to 2560 px wide, with no overlaps.
- [ ] A running agent's pin appears over the file it is editing or reviewing within 1 s of the tool call, and moves when it moves.
- [ ] Clicking a building shows its stats, the diff and the reviewer's notes in the rail. Notes posted to the PR show "Posted to PR".
- [ ] Code City is fully usable by keyboard (one Tab stop, arrows, Enter, Esc), and every building has the accessible name from the keyboard section.
- [ ] Every row of the states table renders as specified.
- [ ] No new user-editable config files. The only new persisted values are `ticketLayout` and `codeCityLegendDismissed`.

**Tests**

| Level | File | Covers |
| --- | --- | --- |
| Unit | `layoutCity.test.ts` | The golden case from the worked example; determinism (shuffled input gives the same output); cap at 40 plus overflow; deleted, binary and renamed files; districts with a root-level file |
| Unit | `attribution.test.ts` (main) | Most lines wins; tie goes to the first editor; a user edit gives null; replay from a fixture transcript gives the same map |
| Unit | `numstat.test.ts` (main) | Committed and working-tree numstat merge; rename `{old => new}` parsing; binary `-\t-` lines |
| Component | `layout-slider.test.tsx` | Click, drag-to-snap, arrows, shortcut, preference write |
| Component | `flight-deck.test.tsx` | Turn click sets `selectedTurn`; tile click sets `selectedFilePath`; donut counts by state |
| Component | `code-city.test.tsx` (jsdom, scene mocked) | Listbox keyboard model, accessible names, the inspector reflecting the selection, empty and error states |
| End to end | `ticket-layouts.spec.ts` (Playwright for Electron) | Open the reference ticket fixture, screenshot Flight deck, toggle, screenshot Code City, click the tallest building and assert the inspector shows FailedSyncFiles.razor +120 −0. Compare against the stored baselines with 1% tolerance |

**Fixture:** create `fixtures/ticket-11726.json` with the five files, five agents, seven turns and four PR threads used in the artboards, so tests and screenshots are deterministic.

## Out of scope and open questions

**Out of scope for this session**

- Directions B (timeline), C (orbit) and E (quest) from the canvas.
- Camera controls in Code City (orbit, pan, zoom). The angle is fixed; only fit-to-panel scaling.
- Per-line blame inside a file. Attribution is per file.
- Native (iOS/Android) Code City. Native gets Flight deck only.
- Changes to the board, the team board or the New agent ticket modal.

**Open questions** (build with the default; change later if the answer differs)

- [ ] Should the layout preference be per ticket instead of global? Default: global.
- [ ] Is credit by "most lines written" right, or should the last editor own the file? Default: most lines.
- [ ] Should Code City count lines touched by `git checkout` or merge from main as "by you or a merge", or hide them? Default: show them in grey.
- [ ] Should the reviewer post findings automatically, or only when you press "Post to PR" in the inspector? Default: automatically, through /pr-comment-actioner, as decided for the Code review lane.
