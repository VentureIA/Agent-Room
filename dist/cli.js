#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import open from "open";
import { processInboxAutonomously } from "./core/autonomous.js";
import { readJson } from "./core/files.js";
import { installMcpConfig } from "./core/install.js";
import { setupAgentRoom } from "./core/setup.js";
import { AgentRoomStore } from "./core/storage.js";
import { startRelay } from "./server/relay.js";
import { startHostedRelay } from "./server/hosted-relay.js";
import { runMcpServer } from "./mcp/server.js";
import { findRoomByInvite, getAgentRoomHome, readProjectLink } from "./core/registry.js";
import { connectRemoteRoom, joinRemoteRoom, RemoteAgentRoomClient } from "./core/remote.js";
import { answerSchema, questionSchema } from "./core/types.js";
const program = new Command();
program
    .name("agentroom")
    .description("Local-first shared understanding layer for AI-coded projects.")
    .option("-p, --port <port>", "local dashboard port", "4317")
    .option("--no-open", "do not open the dashboard automatically")
    .action(async (options) => {
    const { url } = await startRelay({ port: Number(options.port) });
    console.log(`AgentRoom is running: ${url}`);
    if (options.open)
        await open(url);
});
program
    .command("setup")
    .description("Prepare this project for AgentRoom, including permissions and MCP integration files.")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .action(async (options) => {
    const setup = await setupAgentRoom(process.cwd(), {
        name: options.name,
        role: options.role,
        agentKind: options.agent,
        humanOwner: options.owner
    });
    console.log(`AgentRoom setup complete for ${setup.project.name}.`);
    console.log(`Invite code: ${setup.room.inviteCode}`);
    console.log(`Shared room: ${setup.store.roomDir}`);
    console.log(`Permissions: ${setup.files.permissions}`);
    console.log(`Agent guide: ${setup.files.agentGuide}`);
    console.log(`Codex MCP config: ${setup.files.codexMcp}`);
    console.log(`Claude MCP config: ${setup.files.claudeMcp}`);
});
program
    .command("init")
    .description("One-command AgentRoom setup: prepare the project and install MCP for Claude, Codex, or both.")
    .argument("[client]", "claude, codex, or all", "all")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .option("--local-command", "write MCP config pointing to this local checkout instead of npx")
    .option("--package <spec>", "package spec used by generated npx MCP configs")
    .action(async (client, options) => {
    printPixelBanner("init");
    const results = await installClients(parseMcpClients(client, "init"), options);
    printReady("AgentRoom ready", results);
});
program
    .command("install-mcp")
    .description("Install the AgentRoom MCP config into a project-local or custom client config file.")
    .argument("<client>", "codex, claude, or all")
    .option("--config <path>", "custom JSON config path, resolved from the current project")
    .option("--scope <scope>", "project or custom", "project")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .option("--portable", "write MCP config using npx -y agentroom-ai mcp")
    .option("--package <spec>", "package spec used by generated npx MCP configs")
    .action(async (client, options) => {
    if (client !== "codex" && client !== "claude" && client !== "all") {
        throw new Error("install-mcp client must be codex, claude, or all.");
    }
    if (client === "all" && options.config) {
        throw new Error("A single custom --config can only install one MCP client. Run install-mcp codex and install-mcp claude separately.");
    }
    const clients = client === "all" ? ["codex", "claude"] : [client];
    for (const target of clients) {
        const result = await installMcpConfig(process.cwd(), {
            client: target,
            configPath: options.config,
            scope: options.scope,
            name: options.name,
            role: options.role,
            agentKind: options.agent,
            humanOwner: options.owner,
            mcpCommandMode: options.portable ? "portable" : "auto",
            mcpPackageSpec: options.package
        });
        console.log(`Installed AgentRoom MCP for ${result.client}: ${result.configPath}`);
    }
});
program
    .command("install-codex")
    .description("Install AgentRoom MCP into the project-local Codex config.")
    .option("--config <path>", "custom JSON config path, resolved from the current project")
    .option("--scope <scope>", "project or custom", "project")
    .option("--portable", "write MCP config using npx -y agentroom-ai mcp")
    .option("--package <spec>", "package spec used by generated npx MCP configs")
    .action(async (options) => {
    const result = await installMcpConfig(process.cwd(), {
        client: "codex",
        configPath: options.config,
        scope: options.scope,
        mcpCommandMode: options.portable ? "portable" : "auto",
        mcpPackageSpec: options.package
    });
    console.log(`Installed AgentRoom MCP for Codex: ${result.configPath}`);
});
program
    .command("install-claude")
    .description("Install AgentRoom MCP into the project-local Claude Code config.")
    .option("--config <path>", "custom JSON config path, resolved from the current project")
    .option("--scope <scope>", "project or custom", "project")
    .option("--portable", "write MCP config using npx -y agentroom-ai mcp")
    .option("--package <spec>", "package spec used by generated npx MCP configs")
    .action(async (options) => {
    const result = await installMcpConfig(process.cwd(), {
        client: "claude",
        configPath: options.config,
        scope: options.scope,
        mcpCommandMode: options.portable ? "portable" : "auto",
        mcpPackageSpec: options.package
    });
    console.log(`Installed AgentRoom MCP for Claude Code: ${result.configPath}`);
});
program
    .command("connect")
    .description("Connect this project to a local AgentRoom or hosted relay.")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .option("--relay <url>", "hosted AgentRoom relay URL")
    .option("--relay-token <token>", "hosted relay admin token for creating rooms")
    .action(async (options) => {
    if (options.relay) {
        const connected = await connectRemoteRoom(process.cwd(), options.relay, options.relayToken ?? process.env.AGENTROOM_RELAY_ADMIN_TOKEN, {
            name: options.name,
            role: options.role,
            agentKind: options.agent,
            humanOwner: options.owner
        });
        console.log(`Connected ${connected.project.name} to remote AgentRoom.`);
        console.log(`Invite code: ${connected.inviteCode}`);
        console.log(`Relay: ${connected.relayUrl}`);
        if (connected.dashboardUrl)
            console.log(`Dashboard: ${connected.dashboardUrl}`);
        console.log(`Project files: ${process.cwd()}/.agentroom`);
        return;
    }
    const { store, project, room, record } = await AgentRoomStore.createSharedRoom(process.cwd(), {
        name: options.name,
        role: options.role,
        agentKind: options.agent,
        humanOwner: options.owner
    });
    console.log(`Connected ${project.name} to AgentRoom.`);
    console.log(`Invite code: ${room.inviteCode}`);
    console.log(`Shared room: ${record.roomDir}`);
    console.log(`Project files: ${store.projectAgentRoomDir}`);
});
program
    .command("join")
    .description("Join an existing local or hosted room with an invite code.")
    .argument("[inviteCode]", "invite code")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .option("--relay <url>", "hosted AgentRoom relay URL")
    .option("--client <client>", "claude, codex, or all", "all")
    .option("--local-command", "write MCP config pointing to this local checkout instead of npx")
    .option("--package <spec>", "package spec used by generated npx MCP configs")
    .action(async (inviteCode, options) => {
    printPixelBanner("join");
    if (!inviteCode) {
        throw new Error("Join requires an invite code, for example: agentroom join ar_ABC123");
    }
    const clients = parseMcpClients(options.client, "join --client");
    if (options.relay) {
        const joined = await joinRemoteRoom(process.cwd(), options.relay, inviteCode, {
            name: options.name,
            role: options.role,
            agentKind: options.agent,
            humanOwner: options.owner
        });
        console.log(`Joined remote AgentRoom via ${inviteCode} as ${joined.project.name}.`);
        console.log(`Relay: ${joined.relayUrl}`);
        const results = await installClients(clients, options);
        printReady("AgentRoom ready", results);
        return;
    }
    const record = await findRoomByInvite(inviteCode);
    if (!record) {
        throw new Error(`No local AgentRoom invite found for ${inviteCode}. Run connect in the first project, then join from the second project on the same machine.`);
    }
    const { project, room } = await AgentRoomStore.joinSharedRoom(process.cwd(), record, {
        name: options.name,
        role: options.role,
        agentKind: options.agent,
        humanOwner: options.owner
    });
    console.log(`Joined ${room.name} via ${inviteCode} as ${project.name}.`);
    console.log(`Shared room: ${record.roomDir}`);
    const results = await installClients(clients, options);
    printReady("AgentRoom ready", results);
});
program
    .command("invite")
    .description("Print the current room invite code.")
    .action(async () => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        console.log(remote.link.inviteCode);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const room = await store.initialize();
    console.log(room.inviteCode);
});
program
    .command("status")
    .description("Show AgentRoom status.")
    .action(async () => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const state = await remote.getState();
        console.log(`${state.room.name} (${state.room.id})`);
        console.log(`${state.projects.length} project(s), ${state.questions.length} question(s), ${state.decisions.length} decision(s), ${state.contracts.length} contract(s).`);
        console.log(`Linked relay: ${remote.link.relayUrl}`);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    console.log(`${state.room.name} (${state.room.id})`);
    console.log(`${state.projects.length} project(s), ${state.questions.length} question(s), ${state.decisions.length} decision(s), ${state.contracts.length} contract(s).`);
    const link = await readProjectLink(process.cwd());
    if (link)
        console.log(`Linked room: ${link.roomDir}`);
});
program
    .command("projects")
    .description("List projects connected to the current AgentRoom.")
    .action(async () => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const state = await remote.getState();
        for (const project of state.projects) {
            console.log(`${project.id}\t${project.name}\t${project.role}`);
        }
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    for (const project of state.projects) {
        console.log(`${project.id}\t${project.name}\t${project.role}`);
    }
});
program
    .command("inbox")
    .description("List open questions and proposed decisions.")
    .action(async () => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const state = await remote.getState();
        const currentProject = await remote.getCurrentProject();
        printInbox(state, currentProject.id);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    const currentProject = await store.getCurrentProject();
    printInbox(state, currentProject.id);
});
program
    .command("ask")
    .description("Ask a structured question between connected projects.")
    .requiredOption("--from <project>", "source project id or name")
    .requiredOption("--to <project>", "target project id or name")
    .requiredOption("--topic <topic>", "question topic")
    .requiredOption("--question <question>", "question text")
    .option("--impact <impact>", "impact if unresolved", "Needs clarification before integration work continues.")
    .option("--urgency <urgency>", "low, normal, or blocking", "normal")
    .action(async (options) => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const currentProject = await remote.getCurrentProject();
        const to = await remote.getProjectByReference(options.to);
        const from = await remote.getProjectByReference(options.from);
        if (from.id !== currentProject.id) {
            throw new Error(`This project can only ask as ${currentProject.name}. Run the command from ${from.name} to ask as that project.`);
        }
        const question = await remote.askQuestion({
            toProjectId: to.id,
            topic: options.topic,
            question: options.question,
            impact: options.impact,
            urgency: options.urgency
        });
        console.log(`Question recorded: ${question.id}`);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    const currentProject = await store.getCurrentProject();
    const from = resolveProject(state.projects, options.from);
    if (from.id !== currentProject.id) {
        throw new Error(`This project can only ask as ${currentProject.name}. Run the command from ${from.name} to ask as that project.`);
    }
    const to = resolveProject(state.projects, options.to);
    const question = await store.askQuestion(questionSchema.parse({
        fromProjectId: from.id,
        toProjectId: to.id,
        topic: options.topic,
        question: options.question,
        impact: options.impact,
        urgency: options.urgency
    }));
    console.log(`Question recorded: ${question.id}`);
});
program
    .command("process-inbox")
    .description("Autonomously answer open questions for the current project when visible files provide enough evidence.")
    .option("--max-questions <count>", "maximum open questions to process", parsePositiveInt, 5)
    .option("--max-files <count>", "maximum visible files to inspect per question", parsePositiveInt, 30)
    .action(async (options) => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const result = await remote.processInboxAutonomously({
            maxQuestions: options.maxQuestions,
            maxFiles: options.maxFiles
        });
        printProcessInboxResult(result);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const result = await processInboxAutonomously(store, {
        maxQuestions: options.maxQuestions,
        maxFiles: options.maxFiles
    });
    printProcessInboxResult(result);
});
program
    .command("visible-files")
    .description("List files visible to AgentRoom for this project.")
    .action(async () => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const files = await remote.listVisibleFiles();
        for (const file of files)
            console.log(file);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const files = await store.listVisibleFiles();
    for (const file of files)
        console.log(file);
});
program
    .command("read-file")
    .description("Read a visible project file through AgentRoom permissions and redaction.")
    .argument("<path>", "project-relative file path")
    .action(async (relativePath) => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        console.log(await remote.readAllowedProjectFile(relativePath));
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    console.log(await store.readAllowedProjectFile(relativePath));
});
program
    .command("answer")
    .description("Answer a structured AgentRoom question.")
    .argument("<questionId>", "question id")
    .requiredOption("--answer <answer>", "answer text")
    .option("--resolution <resolution>", "suggested resolution")
    .option("--confidence <confidence>", "low, medium, or high", "medium")
    .action(async (questionId, options) => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const currentProject = await remote.getCurrentProject();
        const question = await remote.answerQuestionForProject(currentProject.id, answerSchema.parse({
            questionId,
            answer: options.answer,
            suggestedResolution: options.resolution,
            confidence: options.confidence
        }));
        console.log(`Question answered: ${question.id}`);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const currentProject = await store.getCurrentProject();
    const question = await store.answerQuestionForProject(currentProject.id, answerSchema.parse({
        questionId,
        answer: options.answer,
        suggestedResolution: options.resolution,
        confidence: options.confidence
    }));
    console.log(`Question answered: ${question.id}`);
});
program
    .command("summary")
    .description("Print the human-readable AgentRoom summary.")
    .action(async () => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const state = await remote.getState();
        console.log(state.summary);
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    console.log(state.summary);
});
program
    .command("doctor")
    .description("Run local diagnostics.")
    .action(async () => {
    const remote = await RemoteAgentRoomClient.forLinkedProject();
    if (remote) {
        const state = await remote.getState();
        console.log("AgentRoom doctor");
        console.log(`- AgentRoom home: ${getAgentRoomHome()}`);
        console.log(`- Relay: ${remote.link.relayUrl}`);
        console.log(`- Room: ${state.room.id}`);
        console.log(`- Project directory: ${process.cwd()}/.agentroom`);
        console.log(`- Projects connected: ${state.projects.length}`);
        await printMcpDoctor(process.cwd());
        console.log("- Remote command execution: disabled");
        console.log("- Remote file edits: disabled");
        return;
    }
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    console.log("AgentRoom doctor");
    console.log(`- AgentRoom home: ${getAgentRoomHome()}`);
    console.log(`- Shared room directory: ${store.roomDir}`);
    console.log(`- Project directory: ${store.projectAgentRoomDir}`);
    console.log(`- SQLite/event store: ready`);
    console.log(`- Projects connected: ${state.projects.length}`);
    await printMcpDoctor(process.cwd());
    console.log("- Remote command execution: disabled");
    console.log("- Remote file edits: disabled");
});
program
    .command("permissions")
    .description("Show the local AgentRoom permissions file path.")
    .action(async () => {
    console.log(`${process.cwd()}/.agentroom/permissions.md`);
});
program
    .command("serve-relay")
    .description("Start the hosted AgentRoom relay server for multi-machine rooms.")
    .option("-p, --port <port>", "relay port", process.env.PORT ?? "4318")
    .option("--host <host>", "listen host", process.env.HOST ?? "0.0.0.0")
    .option("--data-dir <path>", "persistent relay data directory")
    .action(async (options) => {
    const { url } = await startHostedRelay({
        port: Number(options.port),
        host: options.host,
        dataDir: options.dataDir
    });
    console.log(`AgentRoom hosted relay is running: ${url}`);
});
program
    .command("mcp")
    .description("Start the AgentRoom MCP server over stdio.")
    .action(async () => {
    await runMcpServer();
});
program.parseAsync().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exit(1);
});
function resolveProject(projects, value) {
    const normalized = value.toLowerCase();
    const project = projects.find((candidate) => candidate.id === value || candidate.name.toLowerCase() === normalized);
    if (!project) {
        throw new Error(`Project not found: ${value}. Run agentroom projects to see available projects.`);
    }
    return project;
}
function parsePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Expected a positive integer, got ${value}`);
    }
    return parsed;
}
function defaultAgentForClients(clients) {
    if (clients.length === 1 && clients[0] === "claude")
        return "Claude";
    if (clients.length === 1 && clients[0] === "codex")
        return "Codex";
    return "Codex";
}
function parseMcpClients(value, label) {
    if (value !== "codex" && value !== "claude" && value !== "all") {
        throw new Error(`${label} must be claude, codex, or all.`);
    }
    return value === "all" ? ["claude", "codex"] : [value];
}
async function installClients(clients, options) {
    const agentKind = options.agent ?? defaultAgentForClients(clients);
    const results = [];
    for (const client of clients) {
        results.push(await installMcpConfig(process.cwd(), {
            client,
            name: options.name,
            role: options.role,
            agentKind,
            humanOwner: options.owner,
            mcpCommandMode: options.localCommand ? "auto" : "portable",
            mcpPackageSpec: options.package
        }));
    }
    return results;
}
function printPixelBanner(mode) {
    const action = mode === "init" ? "BOOT ROOM" : "JOIN ROOM";
    const lines = [
        "+----------------+---+----------------+--------------------------------------+",
        "| NOTES       x  | > | AGENTROOM   o  | AgentRoom.room                       |",
        "+----------------+---+----------------+--------------------------------------+",
        "|                                                                            |",
        "|    AAAAA   GGGG   EEEEE  N   N  TTTTT  RRRR    OOO    OOO   M   M          |",
        "|   A     A G       E      NN  N    T    R   R  O   O  O   O  MM MM          |",
        "|   AAAAAAA G  GGG  EEEE   N N N    T    RRRR   O   O  O   O  M M M          |",
        "|   A     A G    G  E      N  NN    T    R  R   O   O  O   O  M   M          |",
        "|   A     A  GGGG   EEEEE  N   N    T    R   R   OOO    OOO   M   M          |",
        "|                                                                            |",
        "+----------------------------------------------------------------------------+",
        "| MODE: " + action.padEnd(9, " ") + " | MCP: CLAUDE + CODEX | Q/A: AUTO | FILE ALERTS: ON        |",
        "| [project] <---------------- AgentRoom ----------------> [project]          |",
        "+----------------------------------------------------------------------------+"
    ];
    const color = shouldColorizeBanner() ? "\x1b[38;2;60;252;120m" : "";
    const reset = color ? "\x1b[0m" : "";
    console.log("");
    for (const line of lines)
        console.log(`${color}${line}${reset}`);
    console.log("");
}
function shouldColorizeBanner() {
    return Boolean(process.stdout.isTTY && !process.env.NO_COLOR && !process.env.CI);
}
function printReady(heading, results) {
    const setup = results[0]?.setup;
    if (!setup)
        throw new Error("AgentRoom did not install any MCP client.");
    console.log(`${heading} for ${setup.project.name}.`);
    console.log(`Invite code: ${setup.room.inviteCode}`);
    console.log(`Projects can join with: npx -y agentroom-ai join ${setup.room.inviteCode}`);
    for (const result of results) {
        console.log(`${labelMcpClient(result.client)} MCP: OK (${result.configPath})`);
    }
    console.log(`Agent guide: ${setup.files.agentGuide}`);
    console.log("");
    console.log("Restart Claude/Codex, then ask:");
    console.log("Use AgentRoom. Start the session and show connected projects.");
}
function labelMcpClient(client) {
    return client === "claude" ? "Claude" : "Codex";
}
async function printMcpDoctor(projectRoot) {
    const statuses = await Promise.all([
        readMcpStatus(projectRoot, "claude", path.join(projectRoot, ".mcp.json"), "mcpServers"),
        readMcpStatus(projectRoot, "codex", path.join(projectRoot, ".codex", "mcp.json"), "mcp_servers")
    ]);
    for (const status of statuses) {
        console.log(`- ${labelMcpClient(status.client)} MCP: ${status.ok ? "OK" : "MISSING"} (${status.detail})`);
    }
    if (statuses.some((status) => !status.ok)) {
        console.log("- Fix MCP: run `npx -y agentroom-ai init` or `npx -y agentroom-ai join <invite>` from this project, then restart Claude/Codex.");
    }
}
async function readMcpStatus(projectRoot, client, configPath, key) {
    const displayPath = path.relative(projectRoot, configPath) || configPath;
    try {
        const config = await readJson(configPath);
        if (!config)
            return { client, ok: false, detail: `${displayPath} not found` };
        const servers = config[key];
        if (!isJsonObject(servers))
            return { client, ok: false, detail: `${displayPath} has no ${key}.agentroom` };
        const agentroom = servers.agentroom;
        if (!isJsonObject(agentroom))
            return { client, ok: false, detail: `${displayPath} has no ${key}.agentroom` };
        if (typeof agentroom.command !== "string" || !Array.isArray(agentroom.args)) {
            return { client, ok: false, detail: `${displayPath} has malformed ${key}.agentroom` };
        }
        return { client, ok: true, detail: displayPath };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "invalid JSON";
        return { client, ok: false, detail: `${displayPath}: ${message}` };
    }
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function printInbox(state, currentProjectId) {
    const openQuestions = state.questions.filter((question) => question.status === "open" && question.toProjectId === currentProjectId);
    const proposedDecisions = state.decisions.filter((decision) => decision.status === "proposed");
    if (openQuestions.length === 0 && proposedDecisions.length === 0) {
        console.log("Inbox empty.");
        return;
    }
    for (const question of openQuestions) {
        console.log(`QUESTION ${question.id} [${question.urgency}] ${question.topic}: ${question.question}`);
    }
    for (const decision of proposedDecisions) {
        console.log(`DECISION ${decision.id} [${decision.status}] ${decision.title}: ${decision.reason}`);
    }
}
function printProcessInboxResult(result) {
    console.log(`Processed inbox for ${result.project.name}.`);
    for (const item of result.answered) {
        console.log(`ANSWERED ${item.questionId} [${item.confidence}] via ${item.evidenceFiles.join(", ")}`);
    }
    for (const item of result.skipped) {
        console.log(`SKIPPED ${item.questionId}: ${item.reason}`);
    }
    if (result.answered.length === 0 && result.skipped.length === 0) {
        console.log("Inbox empty.");
    }
}
//# sourceMappingURL=cli.js.map