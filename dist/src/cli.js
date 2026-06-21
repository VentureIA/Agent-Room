#!/usr/bin/env node
import { Command } from "commander";
import open from "open";
import { AgentRoomStore } from "./core/storage.js";
import { startRelay } from "./server/relay.js";
import { runMcpServer } from "./mcp/server.js";
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
    .command("connect")
    .description("Connect this project to a local AgentRoom.")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .option("--owner <humanOwner>", "human owner", "Human owner")
    .action(async (options) => {
    const store = new AgentRoomStore();
    const project = await store.connectProject({
        name: options.name,
        role: options.role,
        agentKind: options.agent,
        humanOwner: options.owner
    });
    const state = await store.getState();
    console.log(`Connected ${project.name} to AgentRoom.`);
    console.log(`Invite code: ${state.room.inviteCode}`);
    console.log(`Files created in ${store.agentroomDir}`);
});
program
    .command("join")
    .description("Join an existing local room with an invite code.")
    .argument("[inviteCode]", "invite code")
    .option("--name <name>", "project display name")
    .option("--role <role>", "project role")
    .option("--agent <agentKind>", "primary agent kind", "Codex")
    .action(async (inviteCode, options) => {
    const store = new AgentRoomStore();
    const project = await store.connectProject({
        name: options.name,
        role: options.role,
        agentKind: options.agent
    });
    console.log(`Joined AgentRoom${inviteCode ? ` via ${inviteCode}` : ""} as ${project.name}.`);
});
program
    .command("invite")
    .description("Print the local room invite code.")
    .action(async () => {
    const store = new AgentRoomStore();
    const room = await store.initialize();
    console.log(room.inviteCode);
});
program
    .command("status")
    .description("Show local AgentRoom status.")
    .action(async () => {
    const store = new AgentRoomStore();
    const state = await store.getState();
    console.log(`${state.room.name} (${state.room.id})`);
    console.log(`${state.projects.length} project(s), ${state.questions.length} question(s), ${state.decisions.length} decision(s), ${state.contracts.length} contract(s).`);
});
program
    .command("doctor")
    .description("Run local diagnostics.")
    .action(async () => {
    const store = new AgentRoomStore();
    const state = await store.getState();
    console.log("AgentRoom doctor");
    console.log(`- Room directory: ${store.agentroomDir}`);
    console.log(`- SQLite/event store: ready`);
    console.log(`- Projects connected: ${state.projects.length}`);
    console.log("- Remote command execution: disabled");
    console.log("- Remote file edits: disabled");
});
program
    .command("permissions")
    .description("Show the local AgentRoom permissions file path.")
    .action(async () => {
    const store = new AgentRoomStore();
    await store.initialize();
    console.log(`${store.agentroomDir}/permissions.md`);
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
//# sourceMappingURL=cli.js.map