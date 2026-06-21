import { type RoomRecord } from "./registry.js";
import type { AccessRequest, Contract, Decision, Message, Project, Question, Room, RoomState } from "./types.js";
export declare class AgentRoomStore {
    readonly projectRoot: string;
    readonly projectAgentRoomDir: string;
    readonly roomDir: string;
    readonly agentroomDir: string;
    private db?;
    constructor(projectRoot?: string, options?: {
        roomDir?: string;
    });
    static forLinkedProject(projectRoot?: string): Promise<AgentRoomStore>;
    static requireLinkedProject(projectRoot?: string): Promise<AgentRoomStore>;
    static createSharedRoom(projectRoot?: string, input?: {
        name?: string;
        role?: string;
        agentKind?: string;
        humanOwner?: string;
        path?: string;
    }): Promise<{
        store: AgentRoomStore;
        project: Project;
        room: Room;
        record: RoomRecord;
    }>;
    static joinSharedRoom(projectRoot: string, record: RoomRecord, input?: {
        name?: string;
        role?: string;
        agentKind?: string;
        humanOwner?: string;
        path?: string;
    }): Promise<{
        store: AgentRoomStore;
        project: Project;
        room: Room;
    }>;
    initialize(): Promise<Room>;
    readExistingRoom(): Promise<Room>;
    connectProject(input: {
        name?: string;
        role?: string;
        agentKind?: string;
        humanOwner?: string;
        path?: string;
    }): Promise<Project>;
    connectRemoteProject(input: {
        name: string;
        role?: string;
        agentKind?: string;
        humanOwner?: string;
        path?: string;
        stack?: string[];
    }): Promise<Project>;
    getState(): Promise<RoomState>;
    getCurrentProject(): Promise<Project>;
    getProjectByReference(reference: string): Promise<Project>;
    askQuestion(input: Omit<Question, "id" | "roomId" | "status" | "createdAt">): Promise<Question>;
    answerQuestion(input: {
        questionId: string;
        answer: string;
        suggestedResolution?: string;
        confidence: "low" | "medium" | "high";
    }): Promise<Question>;
    answerQuestionForProject(projectId: string, input: {
        questionId: string;
        answer: string;
        suggestedResolution?: string;
        confidence: "low" | "medium" | "high";
    }): Promise<Question>;
    recordDecision(input: Omit<Decision, "id" | "roomId" | "createdAt">): Promise<Decision>;
    updateDecisionStatus(input: {
        decisionId: string;
        status: "approved" | "rejected" | "applied";
        approvedBy?: string;
    }): Promise<Decision>;
    publishContract(input: Omit<Contract, "id"> & {
        id?: string;
    }): Promise<Contract>;
    updateContractStatus(input: {
        contractId: string;
        status: "active" | "deprecated" | "draft";
    }): Promise<Contract>;
    requestAccess(input: Omit<AccessRequest, "id" | "status" | "createdAt">): Promise<AccessRequest>;
    updateAccessRequestStatus(input: {
        accessRequestId: string;
        status: "approved" | "denied";
    }): Promise<AccessRequest>;
    reportTestResult(input: {
        status: "passed" | "failed" | "skipped";
        command: string;
        summary: string;
        affects?: string[];
    }): Promise<Message>;
    reportTestResultForProject(projectId: string, input: {
        status: "passed" | "failed" | "skipped";
        command: string;
        summary: string;
        affects?: string[];
    }): Promise<Message>;
    listVisibleFiles(): Promise<string[]>;
    readAllowedProjectFile(relativePath: string): Promise<string>;
    readPermissionsMarkdown(): Promise<string>;
    writePermissionsMarkdown(markdown: string): Promise<string>;
    close(): void;
    private openDb;
    private ensureDefaultPermissions;
    private ensureProjectLocalFiles;
    private updateExistingProject;
    private ensureSchema;
    private appendEvent;
    private loadPermissionPolicy;
    private appendJsonl;
    private writeRoomManifest;
    private writeDecisionsMarkdown;
    private assertProjectExists;
}
