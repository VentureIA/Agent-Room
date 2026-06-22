import { type ProcessInboxOptions, type ProcessInboxResult } from "./autonomous.js";
import { type ProjectRoomLink } from "./registry.js";
import type { AccessRequest, Contract, Decision, FileActivity, FileAlert, FileEditCheck, Message, Project, ProjectSnapshot, Question, Room, RoomState } from "./types.js";
export type RemoteProjectInput = {
    name?: string;
    role?: string;
    agentKind?: string;
    humanOwner?: string;
};
export type RemoteConnectResult = {
    room: Room;
    project: Project;
    inviteCode: string;
    relayUrl: string;
    dashboardUrl?: string;
};
type ParsedJoinInvite = {
    inviteCode: string;
    relayUrl?: string;
};
export declare const OFFICIAL_AGENTROOM_RELAY_URL = "https://agent-room.venture-ia.com";
export declare function resolveDefaultRelayUrl(): string | undefined;
export declare class RemoteAgentRoomClient {
    readonly projectRoot: string;
    readonly link: ProjectRoomLink;
    constructor(projectRoot: string, link: ProjectRoomLink);
    static forLinkedProject(projectRoot?: string): Promise<RemoteAgentRoomClient | undefined>;
    static requireLinkedProject(projectRoot?: string): Promise<RemoteAgentRoomClient>;
    getState(): Promise<RoomState>;
    getCurrentProject(): Promise<Project>;
    getProjectByReference(reference: string): Promise<Project>;
    askQuestion(input: {
        toProjectId: string;
        topic: string;
        question: string;
        impact: string;
        urgency: "low" | "normal" | "blocking";
    }): Promise<Question>;
    publishProjectSnapshot(): Promise<ProjectSnapshot>;
    answerQuestionForProject(_projectId: string, input: {
        questionId: string;
        answer: string;
        suggestedResolution?: string;
        confidence: "low" | "medium" | "high";
    }): Promise<Question>;
    recordDecision(input: Omit<Decision, "id" | "roomId" | "createdAt">): Promise<Decision>;
    publishContract(input: Omit<Contract, "id"> & {
        id?: string;
    }): Promise<Contract>;
    requestAccess(input: Omit<AccessRequest, "id" | "status" | "createdAt">): Promise<AccessRequest>;
    reportTestResult(input: {
        status: "passed" | "failed" | "skipped";
        command: string;
        summary: string;
        affects?: string[];
    }): Promise<Message>;
    publishFileActivity(input: Omit<FileActivity, "id" | "roomId" | "projectId" | "createdAt" | "updatedAt">): Promise<FileActivity>;
    checkFileBeforeEdit(input: Omit<FileActivity, "id" | "roomId" | "projectId" | "createdAt" | "updatedAt"> & {
        intent?: string;
    }): Promise<FileEditCheck>;
    confirmFileAlert(input: {
        alertId: string;
        decision: "continue" | "cancel";
        confirmedBy?: string;
        note?: string;
    }): Promise<FileAlert>;
    listFileAlerts(): Promise<FileAlert[]>;
    processInboxAutonomously(options?: ProcessInboxOptions): Promise<ProcessInboxResult>;
    listVisibleFiles(): Promise<string[]>;
    readAllowedProjectFile(relativePath: string): Promise<string>;
    readPermissionsMarkdown(): Promise<string>;
    private request;
}
export declare function connectRemoteRoom(projectRoot: string, relayUrl: string, adminToken: string | undefined, input: RemoteProjectInput): Promise<RemoteConnectResult>;
export declare function joinRemoteRoom(projectRoot: string, relayUrl: string, inviteCode: string, input: RemoteProjectInput): Promise<RemoteConnectResult>;
export declare function createRemoteInviteCode(inviteCode: string, relayUrl: string): string;
export declare function parseJoinInviteCode(inviteCode: string): ParsedJoinInvite;
export declare function isRemoteLink(link: ProjectRoomLink | undefined): link is ProjectRoomLink & {
    relayUrl: string;
    projectId: string;
    projectToken: string;
};
export {};
