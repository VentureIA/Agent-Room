import path from "node:path";
import { ensureSafeDirectory, readJson, writeJson } from "./files.js";
import { isInsideRoot } from "./permissions.js";
import { setupAgentRoom, type AgentRoomSetup, type SetupInput } from "./setup.js";

export type McpClientKind = "codex" | "claude";

export type InstallMcpInput = SetupInput & {
  client: McpClientKind;
  configPath?: string;
  scope?: "project" | "custom";
};

export type InstallMcpResult = {
  client: McpClientKind;
  configPath: string;
  serverName: "agentroom";
  setup: {
    project: AgentRoomSetup["project"];
    room: AgentRoomSetup["room"];
    files: AgentRoomSetup["files"];
  };
};

type JsonObject = Record<string, unknown>;

export async function installMcpConfig(projectRoot = process.cwd(), input: InstallMcpInput): Promise<InstallMcpResult> {
  const setup = await setupAgentRoom(projectRoot, input);
  const configPath = resolveInstallPath(projectRoot, input);
  const key = input.client === "codex" ? "mcp_servers" : "mcpServers";
  const existing = (await readJson<JsonObject>(configPath)) ?? {};
  if (!isPlainObject(existing)) throw new Error(`MCP config must be a JSON object: ${configPath}`);

  const currentServers = existing[key];
  if (currentServers !== undefined && !isPlainObject(currentServers)) {
    throw new Error(`${key} must be a JSON object in ${configPath}.`);
  }
  const servers = isPlainObject(currentServers) ? currentServers : {};
  const serverConfig = input.client === "codex" ? (await readJson<JsonObject>(setup.files.codexMcp))?.mcp_servers : (await readJson<JsonObject>(setup.files.claudeMcp))?.mcpServers;
  if (!isPlainObject(serverConfig) || !isPlainObject(serverConfig.agentroom)) {
    throw new Error(`Generated ${input.client} MCP config is malformed.`);
  }

  await ensureSafeDirectory(path.dirname(configPath));
  await writeJson(configPath, {
    ...existing,
    [key]: {
      ...servers,
      agentroom: serverConfig.agentroom
    }
  });

  return {
    client: input.client,
    configPath,
    serverName: "agentroom",
    setup: {
      project: setup.project,
      room: setup.room,
      files: setup.files
    }
  };
}

export function resolveInstallPath(projectRoot: string, input: Pick<InstallMcpInput, "client" | "configPath" | "scope">): string {
  if (input.configPath) {
    if (path.isAbsolute(input.configPath)) throw new Error("Custom MCP config path must be project-relative.");
    const resolved = path.resolve(projectRoot, input.configPath);
    if (!isInsideRoot(projectRoot, resolved)) throw new Error("Custom MCP config path must stay inside the project.");
    return resolved;
  }
  if (input.scope === "custom") throw new Error("Custom MCP install scope requires configPath.");
  return input.client === "codex"
    ? path.join(path.resolve(projectRoot), ".codex", "mcp.json")
    : path.join(path.resolve(projectRoot), ".mcp.json");
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
