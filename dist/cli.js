#!/usr/bin/env node
import { Command } from "commander";
import open from "open";
import { processInboxAutonomously } from "./core/autonomous.js";
import { installMcpConfig } from "./core/install.js";
import { setupAgentRoom } from "./core/setup.js";
import { AgentRoomStore } from "./core/storage.js";
import { startRelay } from "./server/relay.js";
import { runMcpServer } from "./mcp/server.js";
import { findRoomByInvite, getAgentRoomHome, readProjectLink } from "./core/registry.js";
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
    .command("install-mcp")
    .description("Install the AgentRoom MCP config into a project-local or custom client config file.")
    .argument("<client>", "codex, claude, or all")
    .option("--config <path>", "custom JSON config path, resolved from the current project")
    .option("--scope <scope>", "project or custom", "project")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
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
            humanOwner: options.owner
        });
        console.log(`Installed AgentRoom MCP for ${result.client}: ${result.configPath}`);
    }
});
program
    .command("install-codex")
    .description("Install AgentRoom MCP into the project-local Codex config.")
    .option("--config <path>", "custom JSON config path, resolved from the current project")
    .option("--scope <scope>", "project or custom", "project")
    .action(async (options) => {
    const result = await installMcpConfig(process.cwd(), { client: "codex", configPath: options.config, scope: options.scope });
    console.log(`Installed AgentRoom MCP for Codex: ${result.configPath}`);
});
program
    .command("install-claude")
    .description("Install AgentRoom MCP into the project-local Claude Code config.")
    .option("--config <path>", "custom JSON config path, resolved from the current project")
    .option("--scope <scope>", "project or custom", "project")
    .action(async (options) => {
    const result = await installMcpConfig(process.cwd(), { client: "claude", configPath: options.config, scope: options.scope });
    console.log(`Installed AgentRoom MCP for Claude Code: ${result.configPath}`);
});
program
    .command("connect")
    .description("Connect this project to a local AgentRoom.")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .action(async (options) => {
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
    .description("Join an existing local room with an invite code.")
    .argument("[inviteCode]", "invite code")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .action(async (inviteCode, options) => {
    if (!inviteCode) {
        throw new Error("Join requires an invite code, for example: agentroom join ar_ABC123");
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
});
program
    .command("invite")
    .description("Print the local room invite code.")
    .action(async () => {
    const store = await AgentRoomStore.requireLinkedProject();
    const room = await store.initialize();
    console.log(room.inviteCode);
});
program
    .command("status")
    .description("Show local AgentRoom status.")
    .action(async () => {
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
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    const currentProject = await store.getCurrentProject();
    const openQuestions = state.questions.filter((question) => question.status === "open" && question.toProjectId === currentProject.id);
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
    const store = await AgentRoomStore.requireLinkedProject();
    const result = await processInboxAutonomously(store, {
        maxQuestions: options.maxQuestions,
        maxFiles: options.maxFiles
    });
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
});
program
    .command("visible-files")
    .description("List files visible to AgentRoom for this project.")
    .action(async () => {
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
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    console.log(state.summary);
});
program
    .command("doctor")
    .description("Run local diagnostics.")
    .action(async () => {
    const store = await AgentRoomStore.requireLinkedProject();
    const state = await store.getState();
    console.log("AgentRoom doctor");
    console.log(`- AgentRoom home: ${getAgentRoomHome()}`);
    console.log(`- Shared room directory: ${store.roomDir}`);
    console.log(`- Project directory: ${store.projectAgentRoomDir}`);
    console.log(`- SQLite/event store: ready`);
    console.log(`- Projects connected: ${state.projects.length}`);
    console.log("- Remote command execution: disabled");
    console.log("- Remote file edits: disabled");
});
program
    .command("permissions")
    .description("Show the local AgentRoom permissions file path.")
    .action(async () => {
    const store = await AgentRoomStore.requireLinkedProject();
    await store.initialize();
    console.log(`${store.projectAgentRoomDir}/permissions.md`);
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
//# sourceMappingURL=cli.js.map