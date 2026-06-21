import { type AgentRoomSetup, type SetupInput } from "./setup.js";
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
export declare function installMcpConfig(projectRoot: string | undefined, input: InstallMcpInput): Promise<InstallMcpResult>;
export declare function resolveInstallPath(projectRoot: string, input: Pick<InstallMcpInput, "client" | "configPath" | "scope">): string;
