import type { Room } from "./types.js";
export type RoomRecord = {
    id: string;
    name: string;
    inviteCode: string;
    roomDir: string;
    relayUrl?: string;
    createdAt: string;
    lastOpenedAt: string;
};
export type ProjectRoomLink = {
    roomId: string;
    inviteCode: string;
    roomDir?: string;
    mode?: "local" | "remote";
    relayUrl?: string;
    projectId?: string;
    projectToken?: string;
    linkedAt: string;
};
type RegistryFile = {
    rooms: RoomRecord[];
};
export declare function getAgentRoomHome(): string;
export declare function getProjectAgentRoomDir(projectRoot: string): string;
export declare function getProjectLinkPath(projectRoot: string): string;
export declare function getRegistryPath(home?: string): string;
export declare function loadRegistry(home?: string): Promise<RegistryFile>;
export declare function saveRegistry(registry: RegistryFile, home?: string): Promise<void>;
export declare function registerRoom(room: Room, roomDir: string, relayUrl?: string, home?: string): Promise<RoomRecord>;
export declare function updateRoomRelayUrl(roomId: string, relayUrl: string, home?: string): Promise<RoomRecord | undefined>;
export declare function findRoomByInvite(inviteCode: string, home?: string): Promise<RoomRecord | undefined>;
export declare function findRoomById(roomId: string, home?: string): Promise<RoomRecord | undefined>;
export declare function readProjectLink(projectRoot: string): Promise<ProjectRoomLink | undefined>;
export declare function writeProjectLink(projectRoot: string, record: RoomRecord): Promise<ProjectRoomLink>;
export declare function writeRemoteProjectLink(projectRoot: string, input: {
    roomId: string;
    inviteCode: string;
    relayUrl: string;
    projectId: string;
    projectToken: string;
}): Promise<ProjectRoomLink>;
export declare function resolveLinkedRoom(projectRoot: string, home?: string): Promise<RoomRecord | undefined>;
export declare function ensureRoomDirectories(roomDir: string): Promise<void>;
export declare function hasProjectLink(projectRoot: string): Promise<boolean>;
export {};
