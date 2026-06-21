# AgentRoom

Local-first shared understanding layer for AI-coded projects.

## Try Two Projects Locally

Build the package:

```bash
npm install
npm run build
```

In project A, run the setup command. It connects the project, writes `.agentroom/permissions.md`, and generates Codex/Claude MCP snippets:

```bash
cd /path/to/wordpress-project
node /path/to/Agent-Room/dist/cli.js setup --name WordPress --agent Claude
```

Copy the printed invite code, then in project B:

```bash
cd /path/to/saas-project
node /path/to/Agent-Room/dist/cli.js join ar_XXXXXXX --name SaaS --agent Codex
```

You can also run setup in project B after joining to generate its local MCP files:

```bash
node /path/to/Agent-Room/dist/cli.js setup --name SaaS --agent Codex
```

List connected projects from either folder:

```bash
node /path/to/Agent-Room/dist/cli.js projects
```

Ask a question from project B:

```bash
node /path/to/Agent-Room/dist/cli.js ask \
  --from SaaS \
  --to WordPress \
  --topic case_study.heroImage \
  --question "Can heroImage be null?" \
  --urgency blocking
```

Let project A answer from its visible files:

```bash
node /path/to/Agent-Room/dist/cli.js inbox
node /path/to/Agent-Room/dist/cli.js process-inbox
```

If visible files contain reliable evidence, AgentRoom records the answer automatically. If not, the question stays open.

## Use Inside Codex Or Claude Code

After `setup`, you can install project-local MCP config files:

```bash
node /path/to/Agent-Room/dist/cli.js install-mcp all
```

This writes:

- Codex project config: `<project>/.codex/mcp.json`
- Claude Code project config: `<project>/.mcp.json`

If your client expects another JSON config path, pass one explicitly:

```bash
node /path/to/Agent-Room/dist/cli.js install-codex --scope custom --config .codex/custom-mcp.json
node /path/to/Agent-Room/dist/cli.js install-claude --scope custom --config .mcp.json
```

`setup` still writes copyable snippets for manual client setup:

- Codex: `<project>/.agentroom/integrations/codex-mcp.json`
- Claude Code: `<project>/.agentroom/integrations/claude-mcp.json`
- Agent instructions: `<project>/.agentroom/AGENTROOM_AGENT.md`

Once the MCP server is configured in the agent interface, the agent can call setup, install, status, coordination, file-permission, and autonomous workflow tools directly.

Recommended agent prompt:

```text
Use AgentRoom. Start the session, process your inbox, and tell me what blockers remain.
```

AgentRoom also exposes MCP prompts:

- `agentroom_start_session`
- `agentroom_resolve_blockers`
- `agentroom_publish_contract`
- `agentroom_review_permissions`

Useful MCP tools include:

- `setup_project`, `connect_project`, `join_room`
- `install_client_config`, `install_all_client_configs`
- `start_agent_session`, `open_dashboard`, `summarize_room`, `read_inbox`, `process_inbox`
- `ask_question`, `answer_question`, `record_decision`, `publish_contract`
- `list_visible_files`, `read_allowed_file`, `request_access`
- `read_permissions`, `propose_permissions_update`, `report_test_result`

Open the dashboard from either project:

```bash
node /path/to/Agent-Room/dist/cli.js --no-open
```

Open the printed URL. It includes a local launch token required to activate the dashboard session.

The dashboard is the human approval cockpit. It shows questions, proposed decisions, access requests, and contracts. From there you can approve/reject decisions, approve/deny access requests, activate draft contracts, or deprecate active contracts. The `open_dashboard` MCP tool opens the tokenized dashboard URL in the local browser, but it only returns the clean local origin to the agent.

## Where Data Lives

- Shared room registry: `~/.agentroom/rooms.json`
- Shared room data: `~/.agentroom/rooms/<room-id>/`
- Project-local link and permissions: `<project>/.agentroom/`

`setup` and `connect` can create/connect a shared room for the current project. `join` connects the current project to an existing local room invite. Read-only commands such as `status`, `projects`, `inbox`, `summary`, `mcp`, and the dashboard require an existing project link.
