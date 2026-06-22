```text
+----------------+---+----------------+--------------------------------------+
| NOTES       x  | > | AGENTROOM   o  | AgentRoom.room                       |
+----------------+---+----------------+--------------------------------------+
|                                                                            |
|    AAAAA   GGGG   EEEEE  N   N  TTTTT  RRRR    OOO    OOO   M   M          |
|   A     A G       E      NN  N    T    R   R  O   O  O   O  MM MM          |
|   AAAAAAA G  GGG  EEEE   N N N    T    RRRR   O   O  O   O  M M M          |
|   A     A G    G  E      N  NN    T    R  R   O   O  O   O  M   M          |
|   A     A  GGGG   EEEEE  N   N    T    R   R   OOO    OOO   M   M          |
|                                                                            |
+----------------------------------------------------------------------------+
| MODE: BOOT ROOM | MCP: CLAUDE + CODEX | Q/A: AUTO | FILE ALERTS: ON        |
| [project] <---------------- AgentRoom ----------------> [project]          |
+----------------------------------------------------------------------------+
```

# AgentRoom

AgentRoom is a local-first shared understanding layer for AI-coded projects.

It lets two or more local projects coordinate through a shared room so their AI
agents can ask questions, answer from approved project files, publish contracts,
record decisions, request access, and surface human approvals in a local
dashboard.

The goal is not to replace Codex, Claude Code, or your terminal. AgentRoom gives
those agents a common memory and a safe coordination protocol when several code
bases depend on each other.

## What It Solves

When two projects are coded by different agents, context gets lost quickly:

- one project changes an API contract and the other project does not know;
- an agent needs an answer from another codebase;
- the human becomes the manual relay between both assistants;
- agents need file access, but should not read the whole machine;
- decisions and blockers are scattered across chats, terminals, and notes.

AgentRoom creates a small local coordination layer:

- each project has a local `.agentroom/` folder;
- all connected projects share a room in `~/.agentroom/rooms/`;
- Codex and Claude Code can access AgentRoom through MCP tools;
- agents can coordinate task context automatically before coding;
- the dashboard is only used for human approval and visibility;
- no remote execution and no remote file editing are performed.

## Current Status

AgentRoom is an early local-first prototype. It is usable for local experiments
with multiple projects and MCP-enabled coding agents.

Implemented today:

- local room creation and invite-code joining;
- hosted relay rooms for multi-machine coordination;
- published npm package: `agentroom-ai`;
- project-local permission files;
- Codex and Claude Code MCP config generation;
- MCP tools for setup, status, questions, answers, decisions, contracts, access
  requests, file collision alerts, summaries, direct answers, and autonomous
  task-context coordination;
- a local approval dashboard;
- safe file reads limited by AgentRoom permissions;
- autonomous answers when visible files contain enough evidence;
- CLI fallback commands for every major workflow.

Not implemented yet:

- full SaaS accounts/billing;
- release automation;
- external authentication beyond local launch tokens;
- automatic code modification across projects.

## Requirements

- Node.js `>=20.11`
- npm
- Codex or Claude Code if you want to use the MCP workflow
- macOS, Linux, or another environment that can run Node.js

## Fastest Start

From the first project:

```bash
npx -y agentroom-ai init --name ProjectA
```

The command prints a pixel banner, prepares `.agentroom/`, installs MCP for
Claude Code and Codex, and prints an invite code:

```text
Invite code: ar_XXXXXXX
Projects can join with: npx -y agentroom-ai join ar_XXXXXXX
```

From the second project:

```bash
npx -y agentroom-ai join ar_XXXXXXX --name ProjectB
```

Restart Claude Code or Codex in both projects, then ask the agent:

```text
Use AgentRoom. Start the session and show connected projects.
```

For real tasks, the agent should use AgentRoom automatically:

```text
Use AgentRoom. Before coding, coordinate task context with connected projects.
```

## One-Command Install

The direct npm command is the recommended install path:

```bash
npx -y agentroom-ai init
```

For one client only:

```bash
npx -y agentroom-ai init claude
npx -y agentroom-ai init codex
npx -y agentroom-ai init all
```

With an explicit project name:

```bash
npx -y agentroom-ai init --name Findy
```

The generated MCP config uses a portable command:

```bash
npx -y agentroom-ai mcp
```

This prepares `.agentroom/`, writes the agent guide, and installs the project MCP
config:

- Claude Code: `.mcp.json`
- Codex: `.codex/mcp.json`

There is also a shell installer if you want a curl-based setup:

```bash
curl -fsSL https://agent-room.venture-ia.com/install.sh | sh
```

Restart Claude Code or Codex after running `init`, then ask:

```text
Use AgentRoom. Start the session and connect this project.
```

## Quick Commands

Prepare the first project and create the room:

```bash
npx -y agentroom-ai init
```

Join another project to the same room:

```bash
npx -y agentroom-ai join ar_XXXXXXX
```

List connected projects:

```bash
npx -y agentroom-ai projects
```

Check whether the room and MCP client configs are ready:

```bash
npx -y agentroom-ai doctor
```

Open the local dashboard:

```bash
npx -y agentroom-ai --no-open
```

Start the MCP server manually, if you need to debug a client config:

```bash
npx -y agentroom-ai mcp
```

## Install From GitHub

Clone the repository:

```bash
git clone https://github.com/VentureIA/Agent-Room.git
cd Agent-Room
npm install
npm run build
```

You can then run the CLI with:

```bash
node /path/to/Agent-Room/dist/cli.js --help
```

If you are inside the AgentRoom repository itself, you can also run:

```bash
npm run build
node dist/cli.js --help
```

## Quick Start With Two Local Projects

Imagine you have:

- `/path/to/wordpress-project`
- `/path/to/saas-project`
- `/path/to/Agent-Room`

In the first project, create the shared room:

```bash
cd /path/to/wordpress-project
npx -y agentroom-ai init claude --name WordPress
```

The command prints an invite code like:

```text
Invite code: ar_XXXXXXX
```

In the second project, join the room:

```bash
cd /path/to/saas-project
npx -y agentroom-ai join ar_XXXXXXX --name SaaS --agent Codex
```

`join` also installs or repairs the local Claude/Codex MCP configs, so there is
no separate MCP install step.

List connected projects:

```bash
npx -y agentroom-ai projects
```

Ask a question from the SaaS project to the WordPress project:

```bash
cd /path/to/saas-project
npx -y agentroom-ai ask \
  --from SaaS \
  --to WordPress \
  --topic case_study.heroImage \
  --question "Can heroImage be null?" \
  --urgency blocking
```

Process the WordPress inbox:

```bash
cd /path/to/wordpress-project
npx -y agentroom-ai process-inbox
```

If visible files contain enough evidence, AgentRoom records the answer
automatically. If not, the question remains open for an agent or human to handle.

## Use AgentRoom Inside Codex Or Claude Code

The preferred workflow is to let the agent use AgentRoom through MCP, instead of
typing AgentRoom commands manually in a terminal.

From each project, install or repair the local MCP config:

```bash
cd /path/to/project
npx -y agentroom-ai init all
```

This writes:

- Codex project config: `.codex/mcp.json`
- Claude Code project config: `.mcp.json`

If your client expects a custom config path:

```bash
npx -y agentroom-ai install-codex --portable --scope custom --config .codex/custom-mcp.json
npx -y agentroom-ai install-claude --portable --scope custom --config .mcp.json
```

Restart Codex or Claude Code after installing the MCP config. The agent should
then see the AgentRoom MCP tools.

Recommended prompt inside the agent:

```text
Use AgentRoom. Start the session, process your inbox, and tell me what blockers remain.
```

For autonomous cross-project work, use:

```text
Use AgentRoom. Coordinate task context automatically before coding, answer incoming questions, and ask connected projects for missing context when needed.
```

Useful MCP prompts exposed by AgentRoom:

- `agentroom_start_session`
- `agentroom_create_room_local`
- `agentroom_create_room_online`
- `agentroom_resolve_blockers`
- `agentroom_publish_contract`
- `agentroom_review_permissions`

Useful MCP tools exposed by AgentRoom:

- `setup_project`
- `create_room_local`
- `create_room_online`
- `connect_project`
- `join_room`
- `install_client_config`
- `install_all_client_configs`
- `get_status`
- `open_dashboard`
- `start_agent_session`
- `coordinate_task_context`
- `list_projects`
- `get_invite_code`
- `summarize_room`
- `publish_project_card`
- `ask_question`
- `answer_question`
- `record_decision`
- `publish_contract`
- `read_inbox`
- `process_inbox`
- `list_visible_files`
- `read_allowed_file`
- `read_permissions`
- `propose_permissions_update`
- `request_access`
- `check_file_before_edit`
- `confirm_file_alert`
- `publish_file_activity`
- `list_file_alerts`
- `report_test_result`

## How Autonomous Agent Coordination Works

AgentRoom does not make agents magical. It gives them a shared protocol.
In the agent interface, `ask_question` is direct by default: AgentRoom records
the question, immediately tries to process the target project's visible local
context, and returns the answer inline when evidence is available. The inbox is
only the fallback path when the target project is remote, offline, or lacks
enough visible evidence.

For day-to-day work, agents should call `coordinate_task_context` before
starting any non-trivial task. That tool processes incoming questions, inspects
the connected projects, automatically asks relevant context questions, and
returns direct answers inline when possible. The human does not need to say
"ask AgentRoom" first.

Typical flow:

1. Project A publishes its visible project card, contracts, or decisions.
2. Project B receives a user task and calls `coordinate_task_context`.
3. AgentRoom processes Project B's incoming inbox automatically.
4. AgentRoom asks Project A for any context needed by the task.
5. AgentRoom tries to answer immediately from Project A's visible files.
6. If it cannot, Project A's agent reads its inbox through MCP later.
7. AgentRoom checks files allowed by `.agentroom/permissions.md`.
8. If the answer is supported by visible files, the agent records the answer.
9. If access is missing, the agent creates an access request.
10. Before editing a file, the agent calls `check_file_before_edit`.
11. If another connected project has touched the same file, the agent asks the
   human yes/no inside Codex or Claude Code before continuing.
12. The human approves or rejects sensitive changes in the dashboard.

This keeps the human out of repetitive relay work while keeping sensitive access
and decisions visible.

## File Collision Alerts

AgentRoom can warn an agent before it edits a file that another connected
project has already touched.

The intended native-agent flow is:

1. Codex or Claude Code is about to edit `src/shared/api.ts`.
2. The agent calls `check_file_before_edit` through MCP.
3. If no collision exists, the tool returns `requiresUserConfirmation: false`.
4. If another project has an active file activity on the same project-relative
   path, the tool returns `requiresUserConfirmation: true` and a human prompt.
5. The agent must stop and ask the human in the Codex or Claude Code chat:

```text
AgentRoom detected a possible file collision for src/shared/api.ts.
Another connected project has touched this file. Continue anyway?
```

6. If the human says yes, the agent calls `confirm_file_alert` with
   `decision: "continue"` and may edit.
7. If the human says no, the agent calls `confirm_file_alert` with
   `decision: "cancel"` and should coordinate first.
8. After editing, the agent calls `publish_file_activity` with
   `status: "modified"`.

AgentRoom stores only file metadata such as path, status, branch, repository,
last commit, project id, and timestamps. It does not upload file contents for
this feature.

## Dashboard

Start the local dashboard:

```bash
cd /path/to/project
npx -y agentroom-ai --no-open
```

Open the printed local URL. It includes a local launch token used to activate the
dashboard session.

The dashboard is the human approval cockpit. It shows:

- questions;
- proposed decisions;
- contracts;
- access requests;
- connected projects;
- room summary.

From the dashboard you can:

- approve or reject proposed decisions;
- activate or deprecate contracts;
- approve or deny access requests;
- inspect the current shared room state.

The MCP `open_dashboard` tool can open the tokenized dashboard URL in your local
browser. It only returns the clean local origin to the agent, not the launch
token.

For hosted relay rooms, the dashboard runs on the relay itself. The `connect
--relay` command prints a tokenized dashboard URL:

```text
Dashboard: https://agentroom.example.com/dashboard/ar_XXXXXXX?token=ard_...
```

Open that link once in your browser to create a secure dashboard session cookie.
After that, the clean `/dashboard/ar_XXXXXXX` URL can reload the same room in
that browser. Share the tokenized dashboard link only with humans who are allowed
to approve decisions, contracts, and access requests.

When a hosted room is created from Codex or Claude Code through MCP, the
`connect_project` tool returns `dashboardUrl`, and the creator project's
`open_dashboard` tool can reopen that hosted dashboard later. Projects that only
joined the room do not store the human dashboard token by default.

A relay URL is the public HTTP(S) address of an AgentRoom hosted relay that both
computers can reach, for example `https://agentroom.example.com`. Use a local
room for projects on the same machine. Use an online room for projects on
different machines. From the agent, call `create_room_local` for a same-machine
`ar_` invite, or `create_room_online` with `relayUrl` (or with
`AGENTROOM_RELAY_URL` configured) for a cross-machine `arr_` invite.

## Permission Model

Each connected project gets:

```text
<project>/.agentroom/permissions.md
```

AgentRoom file reads go through this permission layer. Agents do not receive
unrestricted access to every file through AgentRoom.

The permission model is designed around:

- visible project files;
- redacted or blocked sensitive files;
- explicit access requests;
- human approval for permission changes;
- no remote command execution;
- no remote file edits.

The CLI command:

```bash
npx -y agentroom-ai visible-files
```

shows which files are visible to AgentRoom for the current project.

To read one allowed file through AgentRoom:

```bash
npx -y agentroom-ai read-file path/from/project/root.ts
```

## Local Data Layout

AgentRoom is local-first.

Shared registry:

```text
~/.agentroom/rooms.json
```

Shared room data:

```text
~/.agentroom/rooms/<room-id>/
```

Project-local files:

```text
<project>/.agentroom/
```

Generated integration files:

```text
<project>/.agentroom/integrations/codex-mcp.json
<project>/.agentroom/integrations/claude-mcp.json
<project>/.agentroom/AGENTROOM_AGENT.md
```

Project-local MCP configs:

```text
<project>/.codex/mcp.json
<project>/.mcp.json
```

## CLI Reference

The examples below use `agentroom` as the binary name. You can always run the
same commands through npm with:

```bash
npx -y agentroom-ai <command>
```

For local development from a cloned checkout, replace `agentroom` with:

```bash
node /path/to/Agent-Room/dist/cli.js
```

```bash
agentroom init all
agentroom init claude
agentroom init codex
```

Prepare the current project and install project-local MCP config in one command.

```bash
agentroom setup
```

Prepare the current project for AgentRoom, create local permissions, and generate
MCP integration snippets.

```bash
agentroom connect
```

Connect the current project to a new local shared room.

```bash
agentroom join ar_XXXXXXX
```

Join an existing local room with an invite code and install project-local MCP
configs automatically.

```bash
agentroom install-mcp all
agentroom install-mcp codex
agentroom install-mcp claude
```

Install AgentRoom MCP configuration files for Codex and/or Claude Code.
Use `--portable` when you want the generated MCP config to run
`npx -y agentroom-ai mcp`.

```bash
agentroom status
agentroom projects
agentroom invite
agentroom summary
agentroom doctor
```

Inspect the current local room and project connection.

```bash
agentroom ask --from SaaS --to WordPress --topic api.contract --question "..."
agentroom inbox
agentroom answer q_XXXX --answer "..." --confidence high
agentroom process-inbox
```

Ask and answer structured cross-project questions.

```bash
agentroom visible-files
agentroom read-file src/example.ts
agentroom permissions
```

Inspect the local permission surface.

```bash
agentroom mcp
```

Start the AgentRoom MCP server over stdio. This is what Codex or Claude Code runs
when configured through MCP.

```bash
agentroom --no-open
agentroom --port 4317
```

Start the local dashboard server.

## Development

Install dependencies:

```bash
npm install
```

Run type checks:

```bash
npm run typecheck
```

Run lint:

```bash
npm run lint
```

Run tests:

```bash
npm test
```

Build the CLI and dashboard:

```bash
npm run build
```

Run the local dashboard from source:

```bash
npm run dev
```

## Safety Notes

AgentRoom is intentionally conservative:

- it stores coordination state locally;
- it does not run shell commands in other projects through the room;
- it does not edit another project's files;
- it does not expose arbitrary file reads through MCP;
- it requires explicit permission surfaces per project;
- it keeps human approval in the loop for sensitive access and decisions.

You should still review `.agentroom/permissions.md` before using AgentRoom on a
real codebase.

## Recommended First Test

Create two small local projects with mock files:

```text
demo/
  project-wordpress/
    content/case-studies.json
  project-saas/
    src/importer.ts
```

Connect `project-wordpress`, join from `project-saas`, then ask:

```text
Can heroImage be null?
```

Put the answer in `content/case-studies.json` and let `process-inbox` answer
from evidence. Then repeat the same workflow from inside Codex or Claude Code
through the MCP tools.

## Multi-Machine Mode With A Hosted Relay

For two developers on two different computers, run the hosted relay on your own
server, then expose that relay as the default for AgentRoom commands.

Start the relay locally for a quick test:

```bash
npm run build
AGENTROOM_RELAY_ADMIN_TOKEN=change-me \
AGENTROOM_RELAY_DATA_DIR=.agentroom-relay \
AGENTROOM_RELAY_ALLOW_OPEN_CREATE=true \
PORT=4318 \
npm run serve:relay
```

Configure the default relay URL in the developer environment or shell profile:

```bash
export AGENTROOM_RELAY_URL=https://agentroom.example.com
```

Developer A creates the remote room:

```bash
cd /path/to/wordpress-project
npx -y agentroom-ai init
# or: npx -y agentroom-ai connect
```

The command prints:

```text
Invite code: arr_eyJ...
Dashboard: https://agentroom.example.com/dashboard/ar_XXXXXXX?token=ard_...
```

Send the invite code to the other developer. Keep the dashboard link for the
human approver, or share it only with trusted reviewers.

Developer B joins from another computer:

```bash
cd /path/to/saas-project
npx -y agentroom-ai join arr_eyJ...
```

After that, the normal commands work from either machine:

```bash
npx -y agentroom-ai projects
npx -y agentroom-ai ask --from SaaS --to WordPress --topic case_study.heroImage --question "Can heroImage be null?"
npx -y agentroom-ai process-inbox
```

The relay stores shared coordination state. It does not read developer project
files. Each agent reads only its own local files through `.agentroom/permissions.md`
and sends answers, decisions, contracts, and access requests to the relay.

The hosted dashboard is intentionally separate from project tokens:

- project tokens let Codex or Claude Code act for one connected project;
- the dashboard token lets a human view the shared room and approve or reject
  decisions, contracts, and access requests;
- a dashboard session cannot call project-only endpoints.

### Deploy The Relay On Dokploy

AgentRoom includes a `Dockerfile`, so the recommended Dokploy path is an
Application using Dockerfile build. Dokploy supports Dockerfile build types,
service-level environment variables, and domain routing through its UI.

1. Push this repository to GitHub.
2. In Dokploy, create a new Application.
3. Select the GitHub repository `VentureIA/Agent-Room`.
4. Use branch `main`.
5. Select Dockerfile build.
6. Set the exposed/container port to `4318`.
7. Add a persistent volume:

```text
/data
```

8. Add environment variables:

```text
NODE_ENV=production
PORT=4318
HOST=0.0.0.0
AGENTROOM_RELAY_DATA_DIR=/data
AGENTROOM_RELAY_ADMIN_TOKEN=<generate-a-long-random-secret>
```

9. Add your domain in Dokploy, for example:

```text
agentroom.example.com
```

10. Deploy.
11. Verify:

```bash
curl https://agentroom.example.com/healthz
```

Expected response:

```json
{"ok":true,"service":"agentroom-relay"}
```

Then use that URL in `connect --relay` and `join --relay`.

Dokploy references:

- Dockerfile build type: https://docs.dokploy.com/docs/core/applications/build-type
- Environment variables: https://docs.dokploy.com/docs/core/variables
- Production deployment flow: https://docs.dokploy.com/docs/core/applications/going-production

## Repository

Public repository:

```text
https://github.com/VentureIA/Agent-Room
```
