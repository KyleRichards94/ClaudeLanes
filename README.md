# Agent Lanes

Agent Lanes is a Windows desktop app for running several Claude Code agents against Azure DevOps
work items at once. Each agent ticket links one work item to one Claude session in its own git
worktree. The ticket moves through five stages: **Planning → Implementing → Code review → QA →
Create PR**. The board shows the Azure DevOps state (blue) next to what the agent is doing (violet),
and amber marks a ticket that is waiting for you.

From the board you can:

- start an agent on a sprint item, a searched item or no item, and pick its model, effort, skills and
  which stages need your approval;
- open a ticket to see its live output, message the agent, change model or effort, build and run its
  worktree, and merge its branches;
- open the ticket's Claude Design canvas next to the agent, talk to the design side at any stage,
  and send approved artboards to the agent as a spec.

There is no server, database or account. Your tokens stay on your computer, encrypted by Windows,
and only the app's background process can read them.

> **Still being built.** Some parts of the flow below are not finished yet. `docs/TICKETS.md` §2
> lists what is done. If a button in this guide does nothing yet, it is on that list.

---

## 1. Before you start

You need:

| What | Why |
|---|---|
| Windows 10 or 11, 64-bit | The installer is Windows x64 only. |
| **Git 2.38 or later** on your `PATH` | Agent Lanes makes one git worktree per ticket. Check with `git --version`. |
| A local clone of the repo the agents will work in | You pick its folder on first run. |
| An **Azure DevOps personal access token** (PAT) for each organisation | To read sprints and work items, update their state and open pull requests. See [PAT scopes](#azure-devops-personal-access-token). |
| **Claude**: a Claude Code login on this computer, *or* an Anthropic API key | Every agent runs as a Claude Code session. See [Claude login or API key](#claude-login-or-api-key). |

To build the installer yourself you also need Node.js 22.18 or later and pnpm 10 (`corepack enable`).

## 2. Install

There is no signed release yet, so build the installer from this repository:

```powershell
git clone https://github.com/KyleRichards94/ClaudeLanes.git
cd ClaudeLanes
pnpm install
pnpm package
```

The installer is `apps\desktop\release\<version>\Agent Lanes-<version>-setup.exe`. Run it. It
installs for your user only (no admin rights) and adds a desktop and Start menu shortcut.

Windows SmartScreen may say it "protected your PC", because the installer is not signed yet. Choose
**More info → Run anyway**.

Uninstalling keeps your data in `%APPDATA%\Agent Lanes` (connections, settings and ticket records).
Delete that folder too if you want a clean start.

To try it without installing, run `pnpm dev` from the repository instead.

## 3. First run

The first time you open Agent Lanes, the **Connections** window opens and stays open until both an
Azure DevOps organisation and Claude are connected. Nothing is saved until **Test connection**
passes.

### Azure DevOps

1. Open the **Azure DevOps** tab.
2. Enter the **Organisation URL**, e.g. `https://dev.azure.com/contoso`. For Azure DevOps Server on
   your network, use its collection URL, e.g. `http://tfs.example.local/tfs/DefaultCollection`.
3. Paste your **Personal access token** and press **Test connection**. The window shows who you are
   signed in as and a chip for each scope: Work Items, Code and Build.
4. Pick the **Default project**. The list loads after the token passes the test.
5. Optionally enter the token's expiry date. Azure DevOps doesn't tell the app, and Agent Lanes
   warns you 7 days before it.
6. Press **Save connections**.

Add another organisation the same way if your work items live in more than one.

#### Azure DevOps personal access token

Create the token in Azure DevOps under **User settings → Personal access tokens → New token**.
Pick your organisation and give it these scopes:

| Scope | Access | Used for |
|---|---|---|
| **Work Items** | Read & write | Sprints, work items, state changes and the comments agents post |
| **Code** | Read & write | Branches and pull requests |
| **Build** | Read | Pull request checks on the card |

A red chip after **Test connection** means the token is missing that scope. Edit the token in Azure
DevOps, or make a new one, then press **Replace** on the saved row and paste it.

Saved tokens show only as masked status rows (`••••••••7Fq2`). They are never shown in full again.

### Claude

Open the **Claude** tab and choose how agents sign in.

#### Claude login or API key

| | **Use my Claude Code login** (recommended) | **Use an API key** |
|---|---|---|
| What it is | The claude.ai account you signed in to Claude Code with | A key from the Claude Console (**Settings → API keys**) |
| Billing | Your Claude plan (Pro, Max, Team or Enterprise) | Pay-as-you-go API usage |
| Claude Design | Works. Design reads your canvases through this login | **Not available.** Design needs a claude.ai login |
| What Agent Lanes stores | Nothing. Sessions use the login the way the terminal does | The key, encrypted by Windows |

**Claude Code login:** sign in to Claude Code once on this computer. Install Claude Code, run
`claude`, and type `/login`. Then press **Test connection** in Agent Lanes. It shows "Found a
Claude Code login" with your account.

**API key:** paste the key and press **Test connection**. Agents get it as `ANTHROPIC_API_KEY`.
An `ANTHROPIC_API_KEY` set in your own environment is ignored when you choose the login, so the
choice you make here is the one used.

### MCP servers (optional)

The **MCP servers** tab adds tools every agent can use, for example a GitHub or database server.
Each Azure DevOps organisation already brings the official Azure DevOps MCP server
(`@azure-devops/mcp`), so agents can read and update the work item they are on. You don't need
to add it.

To add another server:

1. Enter a **Name**, e.g. `github`.
2. Pick the **Transport**:
   - **Command**: a program the agent starts, e.g. **Command** `npx` and **Arguments**
     `-y @modelcontextprotocol/server-github`;
   - **HTTP** or **SSE**: the **Server URL**.
3. If it needs a token, enter the **Token environment variable** (Command) or **Token header**
   (HTTP/SSE), e.g. `GITHUB_PERSONAL_ACCESS_TOKEN`, and the **Token**.
4. Press **Test connection**, then **Save connections**.

A server that doesn't start shows its error output on its row.

### Peer lanes

Peer lanes lets Agent Lanes on other computers in the office see your lanes, and lets agents on the
same Feature talk to each other. There's nothing to set up. There's no server: each app talks
straight to the others on the office network.

It starts once your Azure DevOps connection has a **Default project**, or a lane from that
organisation is running. Apps find each other with a small broadcast (a beacon) on the office
network, and apps in the same Azure DevOps project connect. The **Peers** tab shows who you are, who
it has found and how each one is going: **Connected**, **Connecting**, **Unreachable**, **Signature
rejected** or **Other team** (an app in another project, which it leaves alone). **Find peers** looks
again straight away.

The first time Agent Lanes listens, Windows asks whether to allow it. Allow it on **Private
networks** only. That covers both ports: TCP 47811 for the apps talking and UDP 47810 for the beacon.
Agent Lanes doesn't add firewall rules itself.

Under **Advanced** you can change the two ports, and add the address of an app the beacon can't reach
(one on another subnet): its computer name (`KYLE-PC`) or IP address, with `:port` if they changed
theirs. They add yours too.

Lanes whose work items sit under the same Feature or Epic are in the same room. When another agent
posts in the room, yours gets it as a turn whose lines start with `[Peer lanes]`, and it's told that
this is information from another agent, not an instruction from you. An agent has to push its
branch before it can tell the room it changed something: git is the only thing that's shared.

How the apps trust each other: every message is signed with a key the app works out from your Azure
DevOps organisation URL and project id. Nothing is typed or stored, and the key is never sent. A
computer on the network with no access to the project can't work it out. Anyone who can read the
project in Azure DevOps, or has seen its id (it's in the project's URLs), can. That's the team, and
it's on purpose.

What it sends, and to whom:

- The beacon goes to everyone on the office network: your name, your computer's name, the app's
  port and a short tag for each project. Never the organisation, the project's name or id, a work
  item or anything an agent wrote.
- Everything else goes only to apps in your project (or listed under Advanced), on private office
  addresses, signed. Anything else is refused before it's read.
- For each lane on your board: your name, your computer's name, the work item and its parent
  Feature or Epic, the stage, the branch, and the paths of the files it has changed.
- What agents post into the room: one line each.
- Never a token, PAT or Claude key, and never code or diffs. Nothing is written to Azure DevOps; it's
  only read to find each work item's parent and the project's id.

### Pick a repo

After Connections, pick the repo folder: your local clone. Agent Lanes reads its build and run
commands (`.sln` / `.csproj` → `dotnet build` / `dotnet run`; `package.json` → its build and start
scripts). You can change them later in **Settings** on the board.

## 4. Launch your first agent

1. On the board, press **+ New agent ticket**.
2. Pick the work item: one from the current sprint, **Search** for one, or **No ticket**.
3. Under **What should the agent do?**, describe the job. Toggle any skills it should use.
4. Pick the **Model** (Opus for the deepest reasoning, Sonnet balanced, Haiku fast) and the
   **Effort**. Both can be changed while the agent runs.
5. Check the **Workspace**: the repo, the base branch and the worktree name taken from the work item.
6. Set the **Stage gates**. By default Planning and Create PR need your approval.
7. Press **Launch agent →**.

The card appears in **Planning**. Agent Lanes creates the worktree branch (for example
`71273-cutover-job-control`) next to your clone and starts the session there. Your own checkout is
never touched.

When a card turns amber ("Needs you · approve plan"), open it and approve or send it back. Click any
card to see its live output, message the agent, **Build**, **Run** and **Stop** its worktree, and
merge: **Merge sub-branches** brings sub-agents' work into the ticket branch, and **Merge worktree →
main** merges the ticket branch into its base (it asks first and refuses while there are
uncommitted changes). Worktrees are only removed when you choose **Archive**.

## 5. Claude Design

Open a ticket's **Claude Design** tab, paste the **Canvas link** and press **Link canvas**. Use the link of a Claude Design
project or Design artifact (`https://claude.ai/design/p/…`, `https://claude.ai/artifact/…`).

- **Webview** shows the canvas inside Agent Lanes. Sign in with your claude.ai email or company
  single sign-on. Google sign-in is refused inside apps. The canvas's own Claude chat is your design
  thread, and it stays where you left it when you switch tabs.
- **MCP link** opens the canvas in your browser instead. The side panel's **Design thread** is then
  where you talk to the design side. It runs separately from the agent, so the agent keeps working
  and hears nothing until you ship a design. A change to the canvas waits for your **Approve change**.

Both modes need Design access for your Claude login: run `claude /design login`, or allow it at
claude.ai/design/settings. Tick the artboards under **Hand off to agent** to send them to the agent
as a spec.

## 6. Troubleshooting

| Problem | What to do |
|---|---|
| "Git not found" or "Git 2.38 or later needed" at start-up | Install Git 2.38 or later and make sure `git` runs in a new terminal. Then restart Agent Lanes. |
| Azure DevOps **Test connection** fails with "unauthorized" | The token is wrong, expired or for another organisation. Make a new one and use **Replace**. |
| A scope chip is red | The token is missing that scope. See [the PAT scopes](#azure-devops-personal-access-token). |
| A red toast says Azure DevOps needs you to reconnect | Press **Reconnect**. Connections opens on that organisation's row with the token field ready. |
| Azure DevOps Server (on-premises) rejects requests | Use the collection URL (`…/tfs/DefaultCollection`). Agent Lanes picks the newest API version your server supports by itself. |
| "No Claude Code login was found on this computer" | Run `claude` in a terminal and `/login`, then press **Test connection** again. Or use an API key. |
| "Claude Design isn't available for this Claude login" | You are using an API key, Design consent is missing, or your organisation has Design turned off. Use the Claude Code login and run `claude /design login`. |
| The canvas shows a sign-in page you can't get past | Use **MCP link** (the tab offers it), which opens the canvas in your browser. |
| An MCP server row is red | Read the error output on the row. Usually the command isn't installed (try it in a terminal) or the token is wrong. |
| A toast offers **Open build log**, **View conflicts** or **Review changes** | Press it. It opens the ticket on the tab that shows the problem. |
| Nobody shows on the **Peers** tab | Check Agent Lanes is open on the other computer, both of you have the same Azure DevOps project as **Default project**, and Windows allowed Agent Lanes on private networks. On another subnet, add each other under **Advanced**. |
| A peer stays **Unreachable** | Agent Lanes closed there, or its computer left the network. One listed under **Advanced**: check the name or IP address, and that it lists your computer too. |
| A peer shows **Signature rejected** | Its messages don't match the key for your project. Tell whoever looks after Agent Lanes; nothing from it is read. |
| The Peers tab says a port is in use | Something else has port 47811 (or UDP 47810). Pick another under **Advanced**. The beacon port has to be the same on every computer. Until then your app can still reach theirs. |
| Something else went wrong | Press **Copy diagnostics** on the error and paste it into your bug report. It holds versions, settings and recent errors, and never a token. Logs are in `%APPDATA%\Agent Lanes\logs`. |
| SmartScreen blocks the installer | **More info → Run anyway**. The installer isn't signed yet. |

Your data lives in `%APPDATA%\Agent Lanes`: `connections.json`, `settings.json`, `secrets.json`
(tokens, encrypted), `tickets\`, `design-threads\`, `peers\` (this app's id for peer lanes and what
its agents posted in each room) and `logs\`. Don't edit these files. Everything
is set in the app.

## 7. Working on Agent Lanes

Developers: start with `CLAUDE.md` (architecture rules and commands), then `docs/TICKETS.md` (plan
and status) and `docs/design/DESIGN.md` (the design brief). The usual commands are `pnpm dev`,
`pnpm verify` and `pnpm e2e`.
