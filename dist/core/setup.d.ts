import { AgentRoomStore } from "./storage.js";
import type { Project, Room } from "./types.js";
export type SetupInput = {
    name?: string;
    role?: string;
    agentKind?: string;
    humanOwner?: string;
    mcpCommandMode?: "auto" | "portable";
    mcpPackageSpec?: string;
};
export type AgentRoomSetup = {
    store: AgentRoomStore;
    project: Project;
    room: Room;
    createdRoom: boolean;
    files: {
        permissions: string;
        agentGuide: string;
        codexMcp: string;
        claudeMcp: string;
    };
};
export declare function setupAgentRoom(projectRoot?: string, input?: SetupInput): Promise<AgentRoomSetup>;
