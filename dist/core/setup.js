import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSafeDirectory, exists, writeJson, writeTextFile } from "./files.js";
import { getProjectAgentRoomDir, resolveLinkedRoom } from "./registry.js";
import { isInsideRoot } from "./permissions.js";
import { RemoteAgentRoomClient } from "./remote.js";
import { AgentRoomStore } from "./storage.js";
export async function setupAgentRoom(projectRoot = process.cwd(), input = {}) {
    const remote = await RemoteAgentRoomClient.forLinkedProject(projectRoot);
    if (remote) {
        const [project, state] = await Promise.all([remote.getCurrentProject(), remote.getState()]);
        const store = new AgentRoomStore(projectRoot, { roomDir: getProjectAgentRoomDir(projectRoot) });
        const files = await writeIntegrationFiles(store, project, input.mcpCommandMode, input.mcpPackageSpec);
        return {
            store,
            project,
            room: state.room,
            createdRoom: false,
            files
        };
    }
    const existingRoom = await resolveLinkedRoom(projectRoot);
    const created = existingRoom
        ? await setupLinkedProject(projectRoot, input)
        : await AgentRoomStore.createSharedRoom(projectRoot, input);
    const files = await writeIntegrationFiles(created.store, created.project, input.mcpCommandMode, input.mcpPackageSpec);
    return {
        store: created.store,
        project: created.project,
        room: created.room,
        createdRoom: !existingRoom,
        files
    };
}
async function setupLinkedProject(projectRoot, input) {
    const store = await AgentRoomStore.requireLinkedProject(projectRoot);
    const project = await store.connectProject(input);
    const room = await store.initialize();
    return { store, project, room };
}
async function writeIntegrationFiles(store, project, mcpCommandMode = "auto", mcpPackageSpec) {
    const integrationsDir = path.join(store.projectAgentRoomDir, "integrations");
    await ensureSafeDirectory(integrationsDir);
    const mcpCommand = await resolveMcpCommand(mcpCommandMode, mcpPackageSpec);
    const mcpServer = {
        command: mcpCommand.command,
        args: [...mcpCommand.args, "mcp"],
        cwd: store.projectRoot,
        env: {
            AGENTROOM_PROJECT_ROOT: store.projectRoot
        }
    };
    const codexMcp = path.join(integrationsDir, "codex-mcp.json");
    const claudeMcp = path.join(integrationsDir, "claude-mcp.json");
    const agentGuide = path.join(store.projectAgentRoomDir, "AGENTROOM_AGENT.md");
    const permissions = path.join(store.projectAgentRoomDir, "permissions.md");
    await writeJson(codexMcp, { mcp_servers: { agentroom: mcpServer } });
    await writeJson(claudeMcp, { mcpServers: { agentroom: mcpServer } });
    await writeTextFile(agentGuide, renderAgentGuide(project));
    return { permissions, agentGuide, codexMcp, claudeMcp };
}
async function resolveMcpCommand(mode = "auto", mcpPackageSpec) {
    if (mode === "portable") {
        return portableMcpCommand(mcpPackageSpec);
    }
    const modulePath = fileURLToPath(import.meta.url);
    const sourceRoot = path.resolve(path.dirname(modulePath), "..", "..");
    const packageRoot = await fs.realpath(sourceRoot);
    const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
    if (argvPath && /(?:^|\/)cli\.(?:js|ts)$/.test(argvPath) && (await isExistingPathInside(argvPath, packageRoot))) {
        const tsxLauncher = process.execArgv.find((value) => /(?:^|\/)tsx(?:\/dist\/cli\.mjs)?$/.test(value));
        if (argvPath.endsWith(".ts") && tsxLauncher && (await exists(tsxLauncher))) {
            return { command: process.execPath, args: [tsxLauncher, argvPath] };
        }
        if (argvPath.endsWith(".js"))
            return { command: process.execPath, args: [argvPath] };
    }
    const distCli = path.resolve(path.dirname(modulePath), "..", "cli.js");
    if (await exists(distCli))
        return { command: process.execPath, args: [distCli] };
    const sourceCli = path.join(sourceRoot, "src", "cli.ts");
    const repoTsx = path.join(sourceRoot, "node_modules", "tsx", "dist", "cli.mjs");
    if ((await exists(sourceCli)) && (await exists(repoTsx))) {
        return { command: process.execPath, args: [repoTsx, sourceCli] };
    }
    return { command: process.execPath, args: [path.join(packageRoot, "dist", "cli.js")] };
}
function portableMcpCommand(mcpPackageSpec) {
    return { command: "npx", args: ["-y", resolvePortablePackageSpec(mcpPackageSpec)] };
}
function resolvePortablePackageSpec(explicitPackageSpec) {
    const explicit = explicitPackageSpec?.trim();
    if (explicit)
        return explicit;
    const envSpec = process.env.AGENTROOM_NPX_PACKAGE?.trim();
    if (envSpec)
        return envSpec;
    const npmExecSpec = process.env.npm_config_package?.trim();
    if (npmExecSpec && isReusableNpxPackageSpec(npmExecSpec))
        return npmExecSpec;
    return "github:VentureIA/Agent-Room";
}
function isReusableNpxPackageSpec(spec) {
    return (spec === "@venture-ia/agentroom" ||
        spec.startsWith("github:") ||
        spec.startsWith("git+") ||
        spec.startsWith("http://") ||
        spec.startsWith("https://") ||
        spec.startsWith("file:") ||
        spec.endsWith(".tgz"));
}
async function isExistingPathInside(candidate, root) {
    try {
        const realCandidate = await fs.realpath(candidate);
        return isInsideRoot(root, realCandidate);
    }
    catch {
        return false;
    }
}
function renderAgentGuide(project) {
    return `# AgentRoom Agent Guide

Project: ${project.name}
Role: ${project.role}
Primary agent: ${project.agentKind}

At the start of each coding session:
- Connect to the AgentRoom MCP server configured for this project.
- If the project is not ready yet, call setup_project, join_room, or install_all_client_configs from MCP instead of asking the human for terminal commands.
- Prefer the agentroom_start_session MCP prompt, or call start_agent_session directly.
- Call summarize_room to understand connected projects, open questions, decisions, access requests, and contracts.
- Call read_inbox, then process_inbox before starting integration work.
- Use ask_question when another project owns missing context.
- Use read_permissions and propose_permissions_update to review visibility rules; do not write permission changes directly from an agent.
- Use list_visible_files and read_allowed_file only for files allowed by .agentroom/permissions.md.
- Use request_access instead of reading hidden or ask-first files directly.
- Before editing or creating a file, call check_file_before_edit with the project-relative path.
- If check_file_before_edit returns requiresUserConfirmation=true, stop and ask the human in ${project.agentKind} whether to continue. Do not edit until the human explicitly says yes, then call confirm_file_alert with decision="continue". If the human says no, call confirm_file_alert with decision="cancel".
- After touching a file that may affect another connected project, call publish_file_activity with status="modified".
- Use report_test_result after verification runs that affect shared contracts.

Autonomous answering rules:
- Answer only from visible project files, published contracts, or explicit room decisions.
- Include the evidence file path when answering.
- If evidence is missing or sensitive, leave the question open and request access or human clarification.
- Do not edit another project through AgentRoom.
- Publish contracts as draft first. Let the dashboard or explicit human approval activate them.
`;
}
//# sourceMappingURL=setup.js.map