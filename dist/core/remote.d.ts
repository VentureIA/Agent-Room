import { type ProcessInboxOptions, type ProcessInboxResult } from "./autonomous.js";
import { type ProjectRoomLink } from "./registry.js";
import type { AccessRequest, Contract, Decision, Message, Project, Question, Room, RoomState } from "./types.js";
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
};
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
    processInboxAutonomously(options?: ProcessInboxOptions): Promise<ProcessInboxResult>;
    listVisibleFiles(): Promise<string[]>;
    readAllowedProjectFile(relativePath: string): Promise<string>;
    readPermissionsMarkdown(): Promise<string>;
    private request;
}
export declare function connectRemoteRoom(projectRoot: string, relayUrl: string, adminToken: string | undefined, input: RemoteProjectInput): Promise<RemoteConnectResult>;
export declare function joinRemoteRoom(projectRoot: string, relayUrl: string, inviteCode: string, input: RemoteProjectInput): Promise<RemoteConnectResult>;
export declare function isRemoteLink(link: ProjectRoomLink | undefined): link is ProjectRoomLink & {
    relayUrl: string;
    projectId: string;
    projectToken: string;
};
