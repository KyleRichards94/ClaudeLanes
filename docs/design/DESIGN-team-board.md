# Agent Lanes — Team Board & Drag-to-Agent (add-on brief)

Local copy of the add-on design brief, taken 2026-10-08 from
https://claude.ai/code/artifact/a9b2b45a-283d-4934-b5b7-54d473f5b6d7 (Claude Doc, rev 27, author Kyle).
It extends `DESIGN.md`; the online doc is the source of truth. Sections are cited as `TB§n`,
requirements as `T1`–`T9`. Built under epic E14 in `docs/TICKETS.md`.

The board gains the team's Azure DevOps board underneath the agent lanes. Dragging a work item or an
active PR onto an agent lane starts the right agent for that stage. The app only changes ADO in one
case: a To Do or Failed item dropped on Planning or Implementing is assigned to you and moved to In
Progress. A Backlog popout feeds the same drag.

## TB§1 Requirements

| # | Requirement | Notes |
|---|---|---|
| T1 | Show the team's ADO board below the agent board | Columns mirror the team's ADO board: To Do, In Progress, Code Review, Testing, Failed, plus an Active PRs column. The team defaults to the one in your ADO profile. Filters: Everyone, Me, Unassigned |
| T2 | Drag team-board cards into agent lanes | Only lanes that accept the card highlight; the others dim |
| T3 | Code Review item or open PR → Code review lane | Starts an agentic code review that posts its comments to the PR through the /pr-comment-actioner skill. No ADO assignment or state change |
| T4 | Your active PR with comments → Implementing lane | Starts a new agent on the PR's source branch that answers and resolves the open threads with /pr-comment-actioner |
| T5 | To Do or Failed item → Planning or Implementing lane | The only drop that changes ADO: assigns you and moves the item to In Progress. Planning keeps the plan gate, Implementing skips it |
| T6 | Backlog opens as a popout modal | Searchable and filterable; its rows drag onto Planning or Implementing the same way |
| T7 | Only your own or unassigned items can be dragged | Items assigned to someone else show a lock. Exception: anyone can review an open PR, and several people can review the same PR at once |
| T8 | Every drop is visible and reversible for 10 s | A toast says what changed and offers Undo before the agent's first turn |
| T9 | All other ADO changes stay in Azure DevOps | The app never moves items between other columns, sets reviewers or changes sprints |

## TB§2 Screens

- **Board at rest** ([08](screens/08-team-board.png)): agent lanes on top, team board below with the
  columns from your profile team's ADO board. Header: "Azure DevOps · CompanionSystems", "Team board",
  team dropdown "Team OSC Developers · from your ADO profile", segmented Everyone / Me / Unassigned,
  hint "Your or unassigned cards · any open PR for review", dark **Backlog 48** button. Cards: grip,
  `#id` chip, type, title, points, assignee avatar; a lock row "Assigned to MD" on others' items;
  an "Agent in Implementing" tag on items that already have an agent; PR cards show `!10598`, PR,
  title, "4 comments" (amber), reviewer avatar.
- **Dragging your PR !10571** ([09](screens/09-team-board-dragging-pr.png)): Implementing (answer
  comments) and Code review (review) light up with what each drop will do; other lanes fade.
- **After dropping Failed item #71318 on Planning** ([10](screens/10-team-board-after-drop.png)): a new
  agent card in Planning; the item is assigned to you and moved to In Progress; toast with Undo for 10 s.
- **Backlog popout** ([11](screens/11-backlog-popout.png)): "Backlog · OSC Developers · 48 items ·
  unassigned items can be dragged onto Planning or Implementing", Pop out, close; search "Search by ID,
  title or tag"; type segmented All / Story / Bug / Task; Priority and Area dropdowns; rows grouped by
  Feature with grip, checkbox, id, type pill, title, tag, points, priority badge.
- **Dragging two selected backlog items** ([12](screens/12-backlog-dragging.png)): the modal fades so
  the lanes beneath take the drop; only Planning and Implementing light up.

## TB§3 Drop rules

Each allowed drop starts one agent with a default skill, model and effort. Only To Do and Failed items
change anything in ADO.

| From | Who can drag | Drop on | ADO changes | Agent starts | Default skill · model |
|---|---|---|---|---|---|
| To Do, Failed or Backlog item | Assigned to you, or unassigned | Planning | Assign to you, move to In Progress | New worktree from main; reads the ticket and plans; plan gate on | — · Opus High |
| To Do, Failed or Backlog item | Assigned to you, or unassigned | Implementing | Assign to you, move to In Progress | New worktree from main; plans and builds with no plan gate | — · Opus High |
| In Progress item | Assigned to you | Planning or Implementing | None | New worktree on the item's branch, or from main if it has none | — · Opus High |
| Code Review item, or any open PR | Anyone; several people at once | Code review | None | Read-only worktree on the PR's source branch; reviews the diff and posts comments to the PR | /code-review + /pr-comment-actioner · Opus High |
| Your open PR with comments | The PR's author | Implementing | None | Worktree on the PR's source branch; fixes or replies to each open thread, resolves it and pushes | /pr-comment-actioner · Sonnet High |
| Testing item | Assigned to you, or unassigned | QA | None | Builds the branch and checks each acceptance criterion | /cs-qa-wip · Sonnet Med |
| Item assigned to someone else, or with an agent already | — | — | — | Not draggable (shows a lock or "Agent in …"); open PRs are the exception for review | — |

- Queued and Create PR never accept drops. Queued fills when the concurrent-agent limit is reached;
  Create PR is only reached through the stages.
- Everything after the drop that touches ADO (review comments, thread replies, PR pushes) is the
  agent's own work through its skills. Moving items between other columns stays in Azure DevOps.
- The defaults are set per lane in Settings and can be overridden for one drop by holding Alt, which
  opens a launch sheet before anything changes.
- An item with no linked PR cannot be dropped on Code review; the lane shows "No linked PR" instead
  of highlighting.

## TB§4 Drop flow

A drop is one main-process transaction: it rechecks the card against ADO, updates ADO only for a To
Do or Failed item, creates the worktree and starts the agent. If any step fails, the steps before it
are rolled back.

```
Drag a card → Drop on a lit lane → Still valid? ──no──▶ Refuse (reason + refresh)
                                        │yes
Start the agent ◀── Create worktree ◀── Update ADO (To Do or Failed only)
(lane skill + model)  (from main or PR branch)
        │
Card in the lane (toast with Undo, 10 s) → Undo? ──yes──▶ Roll back every step (ADO, worktree, session)
                                             └─no: the agent keeps running
```

The recheck catches an item that moved column or was taken by someone else since the board last
refreshed. Undo stays available until the agent finishes its first turn or 10 s pass, whichever comes
first; it reverts any assignment and state change, removes the worktree and ends the session. A review
agent that has already posted comments cannot be undone.

## TB§5 Backlog popout

The Backlog is a modal over the lower part of the board. The agent lanes stay visible and live above
it, so a backlog row can be dragged straight onto a lane.

- **Opening.** The Backlog button in the team board header opens it (it shows the backlog count). Pop
  out moves it to its own window, for a second monitor; dragging between windows works because both
  are the same Electron app.
- **Content.** The backlog of your ADO profile team, in backlog order, grouped by Feature, with
  search, filters for type, priority, area and tags, and a toggle to show items already in a sprint.
- **Dragging.** Each row has a grip handle. When a drag starts, the modal fades to 35 % and stops
  catching the pointer, so the lanes underneath can take the drop. It returns when the drag ends.
- **After a drop.** The row stays in the list with an "Agent in Planning" tag. The item is assigned to
  you and moved to In Progress; its sprint is left as it is in ADO.
- **Multi-select.** Shift-click selects several rows; dragging the group onto a lane starts one agent
  per item. Agents over the concurrency limit go to Queued.
- **Closing.** Esc, the close button, or a click on the board outside the modal. Search and filters are
  remembered for the session.

## TB§6 Architecture changes

Two widgets, three features and one entity rule are added to the Feature-Sliced layout, plus five IPC
channels. Still no database: the team board is read live from ADO.

| Layer | New slice | Responsibility |
|---|---|---|
| Widgets | `team-board` | Columns from the team's ADO board config, cards, filters, Backlog button |
| Widgets | `backlog-popout` | Modal and pop-out window, search, filters, multi-select |
| Features | `drag-to-lane` | Drag state, drop targets, keyboard "Send to lane" menu |
| Features | `launch-from-ado` | Runs the ADO changes, then creates the agent ticket; owns Undo |
| Features | `answer-pr-comments` | PR-specific launch: source-branch worktree and the comment-thread payload |
| Entities | `drop-rules` (in `agent-ticket`) | Pure function `allowedLanes(card) → { lane: action }`, shared by drag highlighting, the keyboard menu and the main process |

| Channel | Direction | Purpose |
|---|---|---|
| `ado:teamBoard` | invoke | Board columns and items for a team and sprint |
| `ado:backlog` | invoke | Backlog items, paged, with filters |
| `ado:activePrs` | invoke | Open PRs for the team's repos with unresolved thread counts |
| `agent:launchFromAdo` | invoke | `{ source, lane, overrides? }` → ADO changes + session start, returns ticket id and an undo token |
| `agent:undoLaunch` | invoke | Reverts the ADO changes and removes the worktree, if the agent has not finished its first turn |

- **Drag-and-drop.** dnd-kit (`@dnd-kit/core`): works in react-native-web and supports keyboard
  sensors. Native HTML5 drag only between the main window and the popped-out Backlog window.
- **Queries.** `['ado','teamBoard',team,sprint]`, `['ado','backlog',filters]`,
  `['ado','activePrs',team]`, refreshed every 60 s and on focus. A drop updates them optimistically and
  invalidates them when the main process confirms.
- **Main-process order.** Recheck the rules against fresh ADO data (state and assignee); assign and move
  to In Progress only for a To Do or Failed drop; create the worktree; start the session. Roll back
  earlier steps on any failure.
- **Identity.** "Assign to me" uses the identity returned by the token test in Connections. No separate
  user profile is stored.

## TB§7 Edge cases and accessibility

| Case | Behaviour |
|---|---|
| Item already assigned to someone else | Not draggable; lock with the assignee's name. Only an open PR can still be dragged, and only onto Code review |
| Item changed or was assigned in ADO since the board loaded | Main rechecks; if it moved column the drop is refused with "Moved to Testing — refreshed" |
| PR has no unresolved threads | Implementing does not highlight; the card shows "0 comments" |
| PR is from another repo than the selected one | Worktree in that repo if connected, otherwise refused with a link to add the repo |
| Concurrent-agent limit reached | Created in Queued; starts when a slot frees |
| Token lacks a scope (e.g. Code write) | Refused with the missing scope named, and a button that opens Connections on that organisation |
| Undo after the agent has pushed | Undo no longer offered; the toast says what to revert by hand |

- Every card is reachable with Tab; Enter opens a "Send to lane" menu listing only allowed lanes and
  their actions, using the same rules as dragging.
- dnd-kit keyboard sensor: Space picks up, arrows move between lanes, Space drops, Esc cancels; each
  move is announced ("Over Code review: start agentic review").
- Accepting lanes change border style (solid → dashed) as well as colour.
- The success toast is a polite live region; Undo is a real button reachable by keyboard for the full 10 s.

## TB§8 Decisions (from the brief)

| Question | Decision |
|---|---|
| Does a code-review agent post its comments or only draft them? | It posts them to the PR, using the /pr-comment-actioner skill set |
| Does the PR-comment agent resolve threads itself? | Yes; it follows /pr-comment-actioner, which replies and resolves |
| Which drops change ADO? | Only a To Do or Failed item dropped on Planning or Implementing: assigned to you and moved to In Progress |
| Which team board shows by default? | The team in your ADO profile |
| Whose items can be dragged? | Only items assigned to you or to no one; open PRs are the exception: anyone can review, several at once |
